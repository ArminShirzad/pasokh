import { prisma } from "@/lib/db/client";
import { classifySendError, isConfirmedSendRejection, isDeliveryUnconfirmed } from "@/lib/instagram/delivery-errors";
import { RateLimitError, createInstagramContext, reactToMessage, sendOutboundMessage } from "@/lib/instagram/provider";
import { validateOutbound, type OutboundMessage } from "@/lib/messages/outbound";
import { matchExact, matchKeywords } from "@/lib/utils/keyword-matcher";

/** A button or quick reply whose payload is this runs the command. */
export const COMMAND_PAYLOAD = /^cmd:([a-z0-9]{8,40})$/;
export const commandPayload = (id: string) => `cmd:${id}`;

export type StoryScope = "ALL" | "ANY_STORY" | "SPECIFIC";
export type MatchMode = "EXACT" | "CONTAINS";

export type CommandTriggerFields = {
  id: string;
  matchMode: string;
  keywords: string[];
  storyScope: string;
  storyIds: string[];
  onStoryMention: boolean;
  createdAt: Date;
};

export type Trigger = { text: string; storyId?: string; isStoryMention?: boolean };

/**
 * How specifically a command matches this message, or 0 if it does not.
 * Higher wins: a command for this exact story beats one for any story, which
 * beats a general DM command, and an exact keyword beats a "contains" one.
 */
export function matchScore(command: CommandTriggerFields, trigger: Trigger): number {
  if (trigger.isStoryMention) return command.onStoryMention ? 50 : 0;

  const scope = command.storyScope as StoryScope;
  let base: number;
  if (trigger.storyId) {
    if (scope === "SPECIFIC") {
      if (!command.storyIds.includes(trigger.storyId)) return 0;
      base = 40;
    } else base = scope === "ANY_STORY" ? 30 : 20;
  } else {
    if (scope !== "ALL") return 0;
    base = 20;
  }

  if (command.keywords.length === 0) {
    // No keywords means "any reply", allowed only for story-scoped commands so
    // a half-filled DM command never answers every message.
    return scope === "ALL" ? 0 : base;
  }
  if (!trigger.text.trim()) return 0;
  if (command.matchMode === "CONTAINS") {
    return matchKeywords(trigger.text, command.keywords, true).matched ? base + 1 : 0;
  }
  return matchExact(trigger.text, command.keywords).matched ? base + 2 : 0;
}

export function pickCommand<T extends CommandTriggerFields>(commands: T[], trigger: Trigger): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const command of commands) {
    const score = matchScore(command, trigger);
    if (score > bestScore || (score === bestScore && score > 0 && best && command.createdAt < best.createdAt)) {
      best = command;
      bestScore = score;
    }
  }
  return best;
}

/** {username} in any text of a response becomes the person's username. */
export function personalize(message: OutboundMessage, username: string | null | undefined): OutboundMessage {
  const fill = (s: string) => s.replace(/\{username\}/gi, username || "");
  switch (message.type) {
    case "text":
      return { ...message, text: fill(message.text) };
    case "cards":
      return {
        ...message,
        cards: message.cards.map((c) => ({ ...c, title: fill(c.title), ...(c.subtitle ? { subtitle: fill(c.subtitle) } : {}) })),
      };
    default:
      return message;
  }
}

type RunnableCommand = {
  id: string;
  likeTrigger: boolean;
  responses: unknown;
  instagramAccount: {
    id: string;
    provider: "META" | "ZERNIO" | "SIMULATOR";
    workspaceId: string;
    zernioAccountId: string | null;
    instagramId: string;
    accessToken: string;
  };
};

/**
 * Sends a command's responses to one person, once per trigger message.
 *
 * The CommandRun row is claimed by (command, trigger message), so a webhook
 * delivered twice or a job retried runs the command once. `sent` counts
 * delivered responses: a retry after a transient failure continues from the
 * first unsent one rather than repeating the earlier ones. A send Instagram
 * may have delivered (ambiguous answer) stops the run as UNCONFIRMED and is
 * never retried, matching how campaigns treat it.
 */
export async function runCommand({
  command,
  igsid,
  triggerMessageId,
  triggerText,
  username,
}: {
  command: RunnableCommand;
  igsid: string;
  triggerMessageId: string;
  triggerText: string;
  username?: string | null;
}): Promise<"DONE" | "FAILED" | "UNCONFIRMED" | "SKIPPED"> {
  const responses = Array.isArray(command.responses) ? (command.responses as OutboundMessage[]) : [];
  const run = await prisma.commandRun.upsert({
    where: { commandId_triggerMessageId: { commandId: command.id, triggerMessageId } },
    create: { commandId: command.id, contactIgsid: igsid, triggerMessageId, triggerText: triggerText.slice(0, 500) },
    update: {},
  });
  if (run.status !== "RUNNING") return "SKIPPED";

  // Responses are validated when saved; one that is invalid now (edited by
  // hand, or limits changed) fails the run cleanly instead of reaching the
  // provider, where its rejection would read as a possibly-delivered send.
  const invalid = responses.findIndex((r) => validateOutbound(r).length > 0);
  if (invalid >= run.sent && invalid !== -1) {
    await prisma.commandRun.update({ where: { id: run.id }, data: { status: "FAILED", error: `Response ${invalid + 1} is not a valid message` } });
    return "FAILED";
  }

  const context = await createInstagramContext(command.instagramAccount, `cmd:${run.id}`);
  const instagramAccountId = command.instagramAccount.instagramId;

  if (command.likeTrigger && run.sent === 0 && !triggerMessageId.startsWith("tap:")) {
    // Best effort: a failed heart must not stop the answer.
    await reactToMessage({ context, instagramAccountId, userId: igsid, messageId: triggerMessageId }).catch(() => {});
  }

  for (let i = run.sent; i < responses.length; i++) {
    try {
      await sendOutboundMessage({
        context,
        instagramAccountId,
        recipient: { userId: igsid },
        message: personalize(responses[i], username),
      });
    } catch (raw) {
      if (raw instanceof RateLimitError) {
        // Nothing was sent; retry later from this response.
        await prisma.commandRun.update({ where: { id: run.id }, data: { error: raw.message } });
        throw raw;
      }
      const error = classifySendError(raw);
      const message = error instanceof Error ? error.message : String(error);
      if (isDeliveryUnconfirmed(error)) {
        await prisma.commandRun.update({ where: { id: run.id }, data: { status: "UNCONFIRMED", error: message } });
        return "UNCONFIRMED";
      }
      if (isConfirmedSendRejection(error)) {
        await prisma.commandRun.update({ where: { id: run.id }, data: { status: "FAILED", error: message } });
        return "FAILED";
      }
      // Transient (rate limit, network before sending): let the job retry,
      // resuming at this response.
      await prisma.commandRun.update({ where: { id: run.id }, data: { error: message } });
      throw error;
    }
    await prisma.commandRun.update({ where: { id: run.id }, data: { sent: i + 1 } });
  }
  await prisma.commandRun.update({ where: { id: run.id }, data: { status: "DONE", error: null } });
  return "DONE";
}

const COMMAND_INCLUDE = {
  instagramAccount: {
    select: { id: true, provider: true, workspaceId: true, zernioAccountId: true, instagramId: true, accessToken: true },
  },
} as const;

export async function activeCommandsFor(instagramId: string, accountConnectionId?: string) {
  return prisma.command.findMany({
    where: {
      isActive: true,
      instagramAccount: { instagramId },
      ...(accountConnectionId ? { instagramAccountId: accountConnectionId } : {}),
    },
    include: COMMAND_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
}

/** A command named by a cmd: payload, only if it belongs to the account that received the tap. */
export async function commandFromPayload(payload: string, instagramId: string) {
  const id = COMMAND_PAYLOAD.exec(payload)?.[1];
  if (!id) return null;
  return prisma.command.findFirst({
    where: { id, isActive: true, instagramAccount: { instagramId } },
    include: COMMAND_INCLUDE,
  });
}

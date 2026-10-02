import { prisma } from "@/lib/db/client";
import { defaultLocale } from "@/lib/i18n";

export const COMMENT_CONTINUE = "comment_continue";

// A private reply can be sent up to 7 days after the comment, and the person
// may answer it any time after that; a week covers the realistic gap without
// keeping stale promises forever.
const COMMENT_CONTINUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Appended to a text-only comment reply so the person knows to answer. The
 * answer opens a normal DM thread, where buttons and cards are allowed again.
 * Campaign copy is the owner's, in their language; this line follows the
 * instance language because there is no per-campaign field for it yet.
 */
export function continuePrompt(): string {
  return defaultLocale() === "fa"
    ? "برای ادامه، هر پیامی (مثلاً «اوکی») در جواب همین پیام بفرست 👇"
    : "Reply to this message with anything (e.g. “ok”) to continue 👇";
}

export function withContinuePrompt(text: string): string {
  const body = text.trim();
  return body ? `${body}\n\n${continuePrompt()}` : continuePrompt();
}

/** Remember what this person's next DM should do. Re-arms on a repeat comment. */
export async function expectCommentAnswer({
  instagramAccountId,
  contactId,
  automationId,
  payload,
}: {
  instagramAccountId: string;
  contactId: string;
  automationId: string;
  payload: string;
}): Promise<void> {
  const expiresAt = new Date(Date.now() + COMMENT_CONTINUE_TTL_MS);
  await prisma.conversationSession.upsert({
    where: {
      instagramAccountId_contactId_kind_automationId: {
        instagramAccountId,
        contactId,
        kind: COMMENT_CONTINUE,
        automationId,
      },
    },
    create: { instagramAccountId, contactId, kind: COMMENT_CONTINUE, automationId, payload, expiresAt },
    update: { payload, expiresAt, consumedAt: null },
  });
}

/**
 * Claims the most recent open session for this person, if any. The claim is a
 * conditional update, so a message delivered twice (webhook retry, polling
 * overlap) resumes the flow once.
 */
export async function claimCommentAnswer({
  instagramId,
  accountConnectionId,
  contactId,
}: {
  instagramId: string;
  accountConnectionId?: string;
  contactId: string;
}): Promise<{ id: string; payload: string; automationId: string; instagramAccountId: string } | null> {
  const now = new Date();
  const session = await prisma.conversationSession.findFirst({
    where: {
      kind: COMMENT_CONTINUE,
      contactId,
      consumedAt: null,
      expiresAt: { gt: now },
      ...(accountConnectionId ? { instagramAccountId: accountConnectionId } : {}),
      instagramAccount: { instagramId },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, payload: true, automationId: true, instagramAccountId: true },
  });
  if (!session) return null;
  const claimed = await prisma.conversationSession.updateMany({
    where: { id: session.id, consumedAt: null },
    data: { consumedAt: now },
  });
  return claimed.count === 1 ? session : null;
}

/** Undo a claim whose continuation could not be queued, so a retry resumes it. */
export async function releaseCommentAnswer(sessionId: string): Promise<void> {
  await prisma.conversationSession.updateMany({
    where: { id: sessionId },
    data: { consumedAt: null },
  });
}

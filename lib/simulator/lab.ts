import { randomBytes } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { processInstagramWebhook } from "@/lib/queue/process-webhook";
import { SIM_LIVE_ID, SIM_POSTS } from "./provider";
import { commandPayload } from "@/lib/commands/engine";

/**
 * The test lab: one simulated Instagram account per workspace and one
 * simulated person. What the person does is turned into the same webhook
 * payload Instagram sends and fed through processInstagramWebhook, so the
 * worker handles it exactly like a real event; what Pasokh sends back is
 * recorded by the SIMULATOR provider (./provider.ts).
 */

export type LabAction =
  | { action: "comment"; postId: string; text: string }
  | { action: "live_comment"; text: string }
  | { action: "dm"; text: string }
  | { action: "tap"; payload: string; title: string; quickReply?: boolean }
  | { action: "story_reply"; text: string }
  | { action: "story_mention" }
  | { action: "follow"; follows: boolean }
  | { action: "reset" };

function newId(prefix: string) {
  return `${prefix}_${randomBytes(9).toString("hex")}`;
}

export async function ensureLab(workspaceId: string) {
  const instagramId = `sim_${workspaceId}`;
  const account =
    (await prisma.instagramAccount.findFirst({ where: { workspaceId, provider: "SIMULATOR" } })) ??
    (await prisma.instagramAccount.create({
      data: {
        workspaceId,
        instagramId,
        username: "pasokh.test",
        name: "Test lab",
        provider: "SIMULATOR",
        accessToken: "",
        webhookSubscribed: true,
      },
    }));
  const fan =
    (await prisma.simulatorFan.findFirst({ where: { instagramAccountId: account.id } })) ??
    (await prisma.simulatorFan.create({
      data: { instagramAccountId: account.id, igsid: newId("simfan"), username: "test.follower", follows: false },
    }));
  return { account, fan };
}

export async function labState(workspaceId: string) {
  const { account, fan } = await ensureLab(workspaceId);
  const [events, iceBreakers] = await Promise.all([
    prisma.simulatorEvent.findMany({
      where: { instagramAccountId: account.id },
      orderBy: { createdAt: "asc" },
      take: 300,
    }),
    prisma.iceBreaker.findMany({ where: { instagramAccountId: account.id }, orderBy: { position: "asc" } }),
  ]);
  return {
    account: { id: account.id, username: account.username },
    fan: { username: fan.username, follows: fan.follows },
    posts: SIM_POSTS.map((p) => ({ id: p.id, caption: p.caption ?? "", type: p.media_type })),
    liveId: SIM_LIVE_ID,
    // Instagram shows these on a chat with no messages yet; a tap is a postback.
    iceBreakers: iceBreakers.map((i) => ({ question: i.question, payload: commandPayload(i.commandId) })),
    events: events.map((e) => ({
      id: e.id,
      direction: e.direction,
      kind: e.kind,
      postId: e.postId,
      commentId: e.commentId,
      body: e.body,
      createdAt: e.createdAt,
    })),
  };
}

export async function runLabAction(workspaceId: string, input: LabAction): Promise<void> {
  const { account, fan } = await ensureLab(workspaceId);
  const record = (kind: string, body: unknown, extra: { postId?: string; commentId?: string } = {}) =>
    prisma.simulatorEvent.create({
      data: {
        instagramAccountId: account.id,
        fanId: fan.id,
        direction: "in",
        kind,
        postId: extra.postId ?? null,
        commentId: extra.commentId ?? null,
        body: body as Prisma.InputJsonValue,
      },
    });
  const deliver = (entry: Record<string, unknown>) =>
    processInstagramWebhook({
      payload: { object: "instagram", entry: [{ id: account.instagramId, time: Date.now(), ...entry }] } as never,
      provider: "SIMULATOR",
      workspaceId,
    });
  const sender = { id: fan.igsid, username: fan.username };
  const recipient = { id: account.instagramId };

  switch (input.action) {
    case "comment": {
      if (!SIM_POSTS.some((p) => p.id === input.postId)) throw new Error("Unknown test post");
      const commentId = newId("simc");
      await record("comment", { text: input.text }, { postId: input.postId, commentId });
      await deliver({
        changes: [{ field: "comments", value: { id: commentId, text: input.text, from: sender, media: { id: input.postId } } }],
      });
      return;
    }
    case "live_comment": {
      const commentId = newId("simc");
      await record("comment", { text: input.text }, { postId: SIM_LIVE_ID, commentId });
      await deliver({
        changes: [{ field: "live_comments", value: { id: commentId, text: input.text, from: sender, media: { id: SIM_LIVE_ID, media_product_type: "LIVE" } } }],
      });
      return;
    }
    case "dm": {
      const mid = newId("simm");
      await record("dm", { type: "text", text: input.text });
      await deliver({ messaging: [{ sender, recipient, message: { mid, text: input.text } }] });
      return;
    }
    case "tap": {
      const mid = newId("simm");
      await record("tap", { title: input.title, payload: input.payload });
      await deliver({
        messaging: [
          input.quickReply
            ? { sender, recipient, message: { mid, text: input.title, quick_reply: { payload: input.payload } } }
            : { sender, recipient, postback: { mid, title: input.title, payload: input.payload } },
        ],
      });
      return;
    }
    case "story_reply": {
      const mid = newId("simm");
      await record("story_reply", { type: "text", text: input.text, storyId: "sim_story_1" });
      await deliver({
        messaging: [{ sender, recipient, message: { mid, text: input.text, reply_to: { story: { id: "sim_story_1" } } } }],
      });
      return;
    }
    case "story_mention": {
      const mid = newId("simm");
      await record("story_mention", {});
      await deliver({
        messaging: [{ sender, recipient, message: { mid, attachments: [{ type: "story_mention", payload: { url: "https://example.invalid/story.jpg" } }] } }],
      });
      return;
    }
    case "follow":
      await prisma.simulatorFan.update({ where: { id: fan.id }, data: { follows: input.follows } });
      return;
    case "reset":
      // A fresh person: new id, not following, no history, so first-contact
      // rules (unknown follow status, closed messaging window) apply again.
      await prisma.$transaction([
        prisma.simulatorEvent.deleteMany({ where: { instagramAccountId: account.id } }),
        prisma.conversationSession.deleteMany({ where: { instagramAccountId: account.id } }),
        prisma.contact.deleteMany({ where: { instagramAccountId: account.id } }),
        prisma.simulatorFan.update({ where: { id: fan.id }, data: { igsid: newId("simfan"), follows: false } }),
      ]);
      return;
  }
}

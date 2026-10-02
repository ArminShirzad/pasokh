import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { MetaApiError } from "@/lib/meta/client";
import type { InstagramComment, InstagramConversation, InstagramMedia, InstagramMessage, InstagramUser } from "@/lib/meta/client";
import { isRich, type OutboundMessage } from "@/lib/messages/outbound";

/**
 * The test-lab provider. Nothing leaves the server: every send is recorded as
 * a SimulatorEvent and shown in the test-lab chat. It enforces the Instagram
 * rules Pasokh's logic depends on, with the same error messages, so a flow
 * that works here is exercising the same branches it will take for real:
 *
 * - one private reply per comment; a second is "invalid for a private reply"
 * - since 2026-08, no buttons, cards or attachments in a private reply to a
 *   non-follower — and the refused attempt still uses up the reply
 * - DMs only within 24 hours of the person's last message or tap
 * - follow status unknown (null) until the person has messaged the account
 */

export type SimulatorContext = { provider: "SIMULATOR"; connectionId: string; instagramId: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const INBOUND_KINDS = ["dm", "tap", "story_reply", "story_mention"];

export const SIM_POSTS: InstagramMedia[] = [
  { id: "sim_post_1", caption: "پست تست ۱ — زیرش «لینک» کامنت بگذارید", media_type: "IMAGE", timestamp: "2026-10-01T09:00:00Z" },
  { id: "sim_post_2", caption: "ریلز تست ۲ — Comment LINK", media_type: "VIDEO", media_product_type: "REELS", timestamp: "2026-10-01T12:00:00Z" },
  { id: "sim_post_3", caption: "پست تست ۳", media_type: "IMAGE", timestamp: "2026-10-02T08:00:00Z" },
];

async function fanByIgsid(context: SimulatorContext, igsid: string) {
  return prisma.simulatorFan.findUnique({
    where: { instagramAccountId_igsid: { instagramAccountId: context.connectionId, igsid } },
  });
}

async function lastInbound(context: SimulatorContext, fanId: string) {
  return prisma.simulatorEvent.findFirst({
    where: { instagramAccountId: context.connectionId, fanId, direction: "in", kind: { in: INBOUND_KINDS } },
    orderBy: { createdAt: "desc" },
  });
}

async function record(
  context: SimulatorContext,
  data: { fanId: string; kind: string; body: unknown; postId?: string | null; commentId?: string | null; direction?: "in" | "out" },
) {
  return prisma.simulatorEvent.create({
    data: {
      instagramAccountId: context.connectionId,
      fanId: data.fanId,
      direction: data.direction ?? "out",
      kind: data.kind,
      postId: data.postId ?? null,
      commentId: data.commentId ?? null,
      body: data.body as Prisma.InputJsonValue,
    },
  });
}

export async function simulatorSend({
  context,
  recipient,
  message,
}: {
  context: SimulatorContext;
  recipient: { userId: string } | { commentId: string; postId?: string };
  message: OutboundMessage;
}): Promise<{ message_id: string; recipient_id: string }> {
  if ("commentId" in recipient) {
    const comment = await prisma.simulatorEvent.findFirst({
      where: { instagramAccountId: context.connectionId, kind: "comment", commentId: recipient.commentId },
    });
    if (!comment) throw new MetaApiError(100, 33, undefined, "Requested user cannot be found [simulator]");
    const used = await prisma.simulatorEvent.count({
      where: { instagramAccountId: context.connectionId, commentId: recipient.commentId, kind: { in: ["private_reply", "private_reply_refused"] } },
    });
    if (used > 0) throw new MetaApiError(100, undefined, undefined, "The comment is invalid for a private reply [simulator]");
    const fan = await prisma.simulatorFan.findUnique({ where: { id: comment.fanId } });
    if (isRich(message) && !fan?.follows) {
      await record(context, { fanId: comment.fanId, kind: "private_reply_refused", commentId: recipient.commentId, postId: comment.postId, body: message });
      throw new MetaApiError(2, 1545133, undefined, "Buttons, cards and attachments are not allowed in a private reply to someone who does not follow the account [simulator]");
    }
    const event = await record(context, { fanId: comment.fanId, kind: "private_reply", commentId: recipient.commentId, postId: comment.postId, body: message });
    return { message_id: event.id, recipient_id: fan?.igsid ?? comment.fanId };
  }

  const fan = await fanByIgsid(context, recipient.userId);
  if (!fan) throw new MetaApiError(100, 33, undefined, "Requested user cannot be found [simulator]");
  const last = await lastInbound(context, fan.id);
  if (!last || Date.now() - last.createdAt.getTime() > DAY_MS) {
    throw new MetaApiError(10, 2018278, undefined, "This message is sent outside of allowed window [simulator]");
  }
  const event = await record(context, { fanId: fan.id, kind: "dm", body: message });
  return { message_id: event.id, recipient_id: fan.igsid };
}

export async function simulatorCommentReply(context: SimulatorContext, commentId: string, text: string): Promise<{ id: string }> {
  const comment = await prisma.simulatorEvent.findFirst({
    where: { instagramAccountId: context.connectionId, kind: "comment", commentId },
  });
  if (!comment) throw new MetaApiError(100, 33, undefined, "Comment not found [simulator]");
  const event = await record(context, { fanId: comment.fanId, kind: "comment_reply", commentId, postId: comment.postId, body: { text } });
  return { id: event.id };
}

export async function simulatorReact(context: SimulatorContext, userId: string, messageId: string): Promise<void> {
  const fan = await fanByIgsid(context, userId);
  if (!fan) throw new MetaApiError(100, 33, undefined, "Requested user cannot be found [simulator]");
  await record(context, { fanId: fan.id, kind: "reaction", body: { messageId, emoji: "❤️" } });
}

/** Unknown until they have messaged the account, as on Instagram. */
export async function simulatorFollowStatus(context: SimulatorContext, igsid: string): Promise<boolean | null> {
  const fan = await fanByIgsid(context, igsid);
  if (!fan) return null;
  return (await lastInbound(context, fan.id)) ? fan.follows : null;
}

export async function simulatorComments(context: SimulatorContext, mediaId: string, sinceMs: number): Promise<InstagramComment[]> {
  const events = await prisma.simulatorEvent.findMany({
    where: { instagramAccountId: context.connectionId, kind: "comment", postId: mediaId, createdAt: { gte: new Date(sinceMs) } },
    orderBy: { createdAt: "asc" },
  });
  const fans = new Map(
    (await prisma.simulatorFan.findMany({ where: { instagramAccountId: context.connectionId } })).map((f) => [f.id, f]),
  );
  return events.map((e) => ({
    id: e.commentId ?? e.id,
    text: String((e.body as { text?: string }).text ?? ""),
    timestamp: e.createdAt.toISOString(),
    from: { id: fans.get(e.fanId)?.igsid ?? e.fanId, username: fans.get(e.fanId)?.username },
  }));
}

export function simulatorUser(context: SimulatorContext): InstagramUser {
  return { id: context.instagramId, user_id: context.instagramId, username: "pasokh.test", name: "Pasokh test lab", followers_count: 0 };
}

export async function simulatorConversations(context: SimulatorContext): Promise<InstagramConversation[]> {
  const fans = await prisma.simulatorFan.findMany({ where: { instagramAccountId: context.connectionId } });
  return fans.map((fan) => ({
    id: fan.igsid,
    participants: { data: [{ id: fan.igsid, username: fan.username }, { id: context.instagramId }] },
  }));
}

export async function simulatorMessages(context: SimulatorContext, conversationId: string): Promise<InstagramMessage[]> {
  const fan = await fanByIgsid(context, conversationId);
  if (!fan) return [];
  const events = await prisma.simulatorEvent.findMany({
    where: { instagramAccountId: context.connectionId, fanId: fan.id, kind: { in: ["dm", "tap", "private_reply", "story_reply"] } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return events.map((e) => {
    const body = e.body as { text?: string; title?: string };
    return {
      id: e.id,
      message: body.text ?? body.title ?? "",
      created_time: e.createdAt.toISOString(),
      from: { id: e.direction === "out" ? context.instagramId : fan.igsid },
    };
  });
}

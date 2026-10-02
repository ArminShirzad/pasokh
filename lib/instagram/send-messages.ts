import { createHash, randomUUID } from "node:crypto";
import * as meta from "@/lib/meta/client";
import {
  zernioRequest,
  ZernioApiError,
  ZernioDeliveryUnconfirmedError,
} from "@/lib/zernio/client";
import type { InstagramContext, ZernioContext } from "./context";
import * as sim from "@/lib/simulator/provider";
import { toMetaMessage, toZernioBody, validateOutbound, type OutboundMessage } from "@/lib/messages/outbound";

type Button =
  | { type: "url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

async function sendZernioMessage({
  context,
  recipientId,
  commentId,
  postId,
  text,
  buttons,
}: {
  context: ZernioContext;
  recipientId?: string;
  commentId?: string;
  postId?: string;
  text: string;
  buttons?: Button[];
}) {
  return postZernioMessage({
    context,
    recipientId,
    commentId,
    postId,
    fields: { message: buttons ? text.slice(0, 640) : text, ...(buttons ? { buttons } : {}) },
  });
}

async function postZernioMessage({
  context,
  recipientId,
  commentId,
  postId,
  fields,
}: {
  context: ZernioContext;
  recipientId?: string;
  commentId?: string;
  postId?: string;
  fields: Record<string, unknown>;
}) {
  const path = commentId
    ? `/inbox/comments/${encodeURIComponent(postId ?? commentId)}/${encodeURIComponent(commentId)}/private-reply`
    : `/inbox/conversations/${encodeURIComponent(recipientId!)}/messages`;
  const body = { accountId: context.accountId, ...fields };
  const idempotencyKey = createHash("sha256")
    .update(
      JSON.stringify({
        operationId: context.operationId ?? randomUUID(),
        path,
        body,
      })
    )
    .digest("hex");
  const result = await zernioRequest<{
    messageId?: string;
    data?: { messageId: string };
  }>({
    apiKey: context.apiKey,
    path,
    method: "POST",
    body,
    ...(commentId ? {} : { idempotencyKey }),
  }).catch((error: unknown) => {
    // A send may have succeeded upstream before a network/5xx failure. The
    // service releases idempotency claims on non-2xx, so do not auto-resend.
    if (error instanceof ZernioApiError && error.code >= 500)
      throw new ZernioDeliveryUnconfirmedError();
    throw error;
  });
  const messageId = result?.messageId ?? result?.data?.messageId;
  if (!messageId) throw new ZernioDeliveryUnconfirmedError();
  return {
    message_id: messageId,
    ...(recipientId ? { recipient_id: recipientId } : {}),
  };
}

function linkButtons(buttons: meta.LinkButton[]): Button[] {
  return buttons
    .slice(0, 3)
    .map(({ title, url }) => ({ type: "url", title: title.slice(0, 20), url }));
}

export async function sendPrivateReply({
  context,
  instagramAccountId,
  commentId,
  message,
  postId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  message: string;
  postId?: string;
}) {
  if (context.provider === "SIMULATOR")
    return sim.simulatorSend({ context, recipient: { commentId, postId }, message: { type: "text", text: message } });
  if (context.provider === "META")
    return meta.sendPrivateReply(
      context.accessToken,
      instagramAccountId,
      commentId,
      message
    );
  return sendZernioMessage({ context, commentId, postId, text: message });
}

export async function sendPrivateReplyWithButton({
  context,
  instagramAccountId,
  commentId,
  text,
  buttonTitle,
  payload,
  postId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  text: string;
  buttonTitle: string;
  payload: string;
  postId?: string;
}) {
  if (context.provider === "SIMULATOR")
    return sim.simulatorSend({
      context,
      recipient: { commentId, postId },
      message: { type: "text", text, buttons: [{ type: "postback", title: buttonTitle.slice(0, 20), payload }] },
    });
  if (context.provider === "META")
    return meta.sendPrivateReplyWithButton(
      context.accessToken,
      instagramAccountId,
      commentId,
      text,
      buttonTitle,
      payload
    );
  return sendZernioMessage({
    context,
    commentId,
    postId,
    text: text,
    buttons: [{ type: "postback", title: buttonTitle.slice(0, 20), payload }],
  });
}

export async function sendDirectMessageWithButton({
  context,
  instagramAccountId,
  userId,
  text,
  buttonTitle,
  payload,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  text: string;
  buttonTitle: string;
  payload: string;
}) {
  if (context.provider === "SIMULATOR")
    return sim.simulatorSend({
      context,
      recipient: { userId },
      message: { type: "text", text, buttons: [{ type: "postback", title: buttonTitle.slice(0, 20), payload }] },
    });
  if (context.provider === "META")
    return meta.sendDirectMessageWithButton(
      context.accessToken,
      instagramAccountId,
      userId,
      text,
      buttonTitle,
      payload
    );
  return sendZernioMessage({
    context,
    recipientId: userId,
    text: text,
    buttons: [{ type: "postback", title: buttonTitle.slice(0, 20), payload }],
  });
}

export async function sendPrivateReplyWithLinkButton({
  context,
  instagramAccountId,
  commentId,
  text,
  buttons,
  postId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  commentId: string;
  text: string;
  buttons: meta.LinkButton[];
  postId?: string;
}) {
  if (context.provider === "SIMULATOR")
    return sim.simulatorSend({ context, recipient: { commentId, postId }, message: { type: "text", text, buttons: linkButtons(buttons) } });
  if (context.provider === "META")
    return meta.sendPrivateReplyWithLinkButton(
      context.accessToken,
      instagramAccountId,
      commentId,
      text,
      buttons
    );
  return sendZernioMessage({
    context,
    commentId,
    postId,
    text: text,
    buttons: linkButtons(buttons),
  });
}

export async function sendDirectMessage({
  context,
  instagramAccountId,
  userId,
  message,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  message: string;
}) {
  if (context.provider === "SIMULATOR")
    return sim.simulatorSend({ context, recipient: { userId }, message: { type: "text", text: message } });
  if (context.provider === "META")
    return meta.sendDirectMessage(
      context.accessToken,
      instagramAccountId,
      userId,
      message
    );
  return sendZernioMessage({ context, recipientId: userId, text: message });
}

export async function sendDirectMessageWithLinkButton({
  context,
  instagramAccountId,
  userId,
  text,
  buttons,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  text: string;
  buttons: meta.LinkButton[];
}) {
  if (context.provider === "SIMULATOR")
    return sim.simulatorSend({ context, recipient: { userId }, message: { type: "text", text, buttons: linkButtons(buttons) } });
  if (context.provider === "META")
    return meta.sendDirectMessageWithLinkButton(
      context.accessToken,
      instagramAccountId,
      userId,
      text,
      buttons
    );
  return sendZernioMessage({
    context,
    recipientId: userId,
    text: text,
    buttons: linkButtons(buttons),
  });
}

export async function sendCommentReply({
  context,
  commentId,
  message,
  postId,
}: {
  context: InstagramContext;
  commentId: string;
  message: string;
  postId?: string;
}) {
  if (context.provider === "SIMULATOR") return sim.simulatorCommentReply(context, commentId, message);
  if (context.provider === "META")
    return meta.sendCommentReply(context.accessToken, commentId, message);
  const result = await zernioRequest<{ data: { commentId: string } }>({
    apiKey: context.apiKey,
    path: `/inbox/comments/${encodeURIComponent(postId ?? commentId)}`,
    method: "POST",
    body: { accountId: context.accountId, commentId, message },
  }).catch((error: unknown) => {
    if (error instanceof ZernioApiError && error.code >= 500) throw new ZernioDeliveryUnconfirmedError();
    throw error;
  });
  if (!result?.data?.commentId) throw new ZernioDeliveryUnconfirmedError();
  return { id: result.data.commentId };
}

/** Where a message goes: an open DM thread, or the private reply to a comment. */
export type Recipient = { userId: string } | { commentId: string; postId?: string };

/**
 * Sends one OutboundMessage (text with buttons or quick replies, media, or
 * cards) through the account's provider. Validate with validateOutbound()
 * before saving a message; this throws on an invalid one rather than let the
 * provider reject it with a less useful error.
 */
export async function sendOutboundMessage({
  context,
  instagramAccountId,
  recipient,
  message,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  recipient: Recipient;
  message: OutboundMessage;
}): Promise<{ message_id: string; recipient_id?: string }> {
  const problems = validateOutbound(message);
  if (problems.length) throw new Error(`Invalid message: ${problems.map((p) => `${p.path}: ${p.message}`).join("; ")}`);
  if ("commentId" in recipient && message.type !== "text") {
    // Neither API takes media or cards in a private reply.
    throw new Error("A private reply to a comment can only be text, with buttons or quick replies.");
  }
  if (context.provider === "SIMULATOR") return sim.simulatorSend({ context, recipient, message });
  if (context.provider === "META") {
    return meta.sendMessage(
      context.accessToken,
      instagramAccountId,
      "commentId" in recipient ? { comment_id: recipient.commentId } : { id: recipient.userId },
      toMetaMessage(message)
    );
  }
  return postZernioMessage({
    context,
    ...("commentId" in recipient
      ? { commentId: recipient.commentId, postId: recipient.postId }
      : { recipientId: recipient.userId }),
    fields: toZernioBody(message),
  });
}

/**
 * Reacts to one of their messages (Directam's "like the trigger message").
 * Meta's Instagram API only offers the heart; Zernio takes any emoji, so the
 * heart is used on both for the same result.
 */
export async function reactToMessage({
  context,
  instagramAccountId,
  userId,
  messageId,
}: {
  context: InstagramContext;
  instagramAccountId: string;
  userId: string;
  messageId: string;
}): Promise<void> {
  if (context.provider === "SIMULATOR") {
    await sim.simulatorReact(context, userId, messageId);
    return;
  }
  if (context.provider === "META") {
    await meta.reactToMessage(context.accessToken, instagramAccountId, userId, messageId);
    return;
  }
  await zernioRequest({
    apiKey: context.apiKey,
    path: `/inbox/conversations/${encodeURIComponent(userId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    method: "POST",
    body: { accountId: context.accountId, emoji: "❤️" },
  });
}

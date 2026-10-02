import { createHmac, timingSafeEqual } from "crypto";

export function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) return false;

  // Instagram-Login apps sign webhooks with the Instagram app secret, while
  // Facebook-Login apps use the Facebook app secret. Both belong to the same
  // app, so accept a signature that matches either — this avoids a config
  // guess about which key Meta uses for a given app type.
  const secrets = [
    process.env.FACEBOOK_APP_SECRET,
    process.env.INSTAGRAM_APP_SECRET,
  ].filter((s): s is string => Boolean(s));

  if (secrets.length === 0) {
    throw new Error(
      "FACEBOOK_APP_SECRET or INSTAGRAM_APP_SECRET is required to verify webhooks"
    );
  }

  return secrets.some((secret) => {
    const expected =
      "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    try {
      return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

export interface WebhookCommentEvent {
  instagramAccountId: string;
  commentId: string;
  commentText: string;
  commenterId: string;
  commenterName?: string;
  mediaId: string;
  /**
   * Set only when the comment was left on an ad: the id of the organic post
   * the ad was created from. Campaigns are configured against that post, so
   * matching has to consider it as well as mediaId.
   */
  originalMediaId?: string;
}

interface WebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: {
      id?: string;
      comment_id?: string;
      text?: string;
      from?: {
        id?: string;
        username?: string;
      };
      media?: {
        id?: string;
        // Present when media_product_type is "AD": the ad copy gets its own
        // media id, and this points back to the post it was boosted from.
        original_media_id?: string;
        ad_id?: string;
        media_product_type?: string;
      };
      media_id?: string;
    };
  }>;
  messaging?: Array<{
    // username is not part of Meta's payload; Zernio events normalised into
    // this shape carry it (lib/zernio/normalize-event.ts).
    sender?: { id?: string; username?: string };
    recipient?: { id?: string };
    postback?: { mid?: string; title?: string; payload?: string };
    read?: { watermark?: number; seq?: number };
    message?: {
      mid?: string;
      text?: string;
      is_echo?: boolean;
      is_deleted?: boolean;
      is_unsupported?: boolean;
      attachments?: Array<{ type?: string; payload?: { url?: string } }>;
      // A tap on a quick reply: `text` is its label, `payload` is ours.
      quick_reply?: { payload?: string };
      // A reply to one of the account's stories.
      reply_to?: { mid?: string; story?: { id?: string; url?: string } };
    };
  }>;
}

export interface WebhookMessageEvent {
  instagramAccountId: string;
  messageId: string;
  /** Trimmed; empty for a message that is only an attachment or mention. */
  messageText: string;
  senderId: string;
  senderUsername?: string;
  quickReplyPayload?: string;
  storyId?: string;
  /** They mentioned the account in their own story. */
  isStoryMention?: boolean;
  attachments?: Array<{ type: string; url?: string }>;
}

export interface WebhookPostbackEvent {
  instagramAccountId: string;
  userId: string;
  payload: string;
  mid?: string;
}

export interface WebhookReadEvent {
  instagramAccountId: string;
  userId: string;
  watermark?: number;
}

interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export function parseCommentEvents(payload: WebhookPayload): WebhookCommentEvent[] {
  const events: WebhookCommentEvent[] = [];

  if (payload.object !== "instagram") {
    return events;
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;

      const value = change.value;
      const commentId = value?.id ?? value?.comment_id;
      const mediaId = value?.media?.id ?? value?.media_id;
      // A comment on a boosted post arrives with the ad's media id, while the
      // campaign is set up against the organic post. Keep both so the worker
      // can match either one.
      const originalMediaId =
        value?.media?.original_media_id === mediaId
          ? undefined
          : value?.media?.original_media_id;
      const commenterId = value?.from?.id;

      if (!entry.id || !commentId || !mediaId || !commenterId) {
        continue;
      }

      // Skip the connected account's own comments and comment replies.
      // A private reply to yourself is rejected by Meta, so queueing one
      // only produces a failed log and wasted retries.
      if (commenterId === entry.id) {
        continue;
      }

      events.push({
        instagramAccountId: entry.id,
        commentId,
        commentText: value.text ?? "",
        commenterId,
        commenterName: value.from?.username,
        mediaId,
        originalMediaId,
      });
    }
  }

  return events;
}

/**
 * Parse button-tap postbacks (from an opening DM's button) out of a webhook
 * payload. Each event carries the tapping user's IGSID and our postback payload.
 */
export function parsePostbackEvents(
  payload: WebhookPayload
): WebhookPostbackEvent[] {
  const events: WebhookPostbackEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const postbackPayload = messaging.postback?.payload;
      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!postbackPayload || !userId || !accountId) continue;
      // Ignore echoes of the account's own actions.
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        payload: postbackPayload,
        mid: messaging.postback?.mid,
      });
    }
  }

  return events;
}

/**
 * Parse inbound Instagram DMs out of a webhook payload: text, quick-reply
 * taps, story replies, story mentions and attachments.
 *
 * Echoes (messages the account itself sent, including our own autoreplies)
 * and deletions are dropped here so the worker never sees them — an echo would
 * otherwise let an autoreply containing its own keyword trigger itself. A
 * message with no text is kept only when it carries something to act on
 * (OpenReply dropped all of them, which also dropped story mentions).
 */
export function parseMessageEvents(
  payload: WebhookPayload
): WebhookMessageEvent[] {
  const events: WebhookMessageEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      const message = messaging.message;
      if (!message) continue;
      if (message.is_echo || message.is_deleted || message.is_unsupported) {
        continue;
      }

      const text = message.text?.trim() ?? "";
      const messageId = message.mid;
      const senderId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;
      const attachments = (message.attachments ?? [])
        .filter((a): a is { type: string; payload?: { url?: string } } => typeof a.type === "string")
        .map((a) => ({ type: a.type, ...(a.payload?.url ? { url: a.payload.url } : {}) }));
      const quickReplyPayload = message.quick_reply?.payload || undefined;
      const storyId = message.reply_to?.story?.id || undefined;
      const isStoryMention = attachments.some((a) => a.type === "story_mention");

      if (!messageId || !senderId || !accountId) continue;
      if (!text && !quickReplyPayload && !storyId && attachments.length === 0) continue;
      // Ignore anything the connected account sent to itself.
      if (senderId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        messageId,
        messageText: text,
        senderId,
        ...(messaging.sender?.username ? { senderUsername: messaging.sender.username } : {}),
        ...(quickReplyPayload ? { quickReplyPayload } : {}),
        ...(storyId ? { storyId } : {}),
        ...(isStoryMention ? { isStoryMention } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
    }
  }

  return events;
}

/**
 * Parse Instagram DM read receipts. When a user reads an opening DM but does
 * not tap its button, the webhook route uses this to schedule the reveal after
 * a short grace period.
 */
export function parseReadEvents(payload: WebhookPayload): WebhookReadEvent[] {
  const events: WebhookReadEvent[] = [];

  if (payload.object !== "instagram") return events;

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      if (!messaging.read) continue;

      const userId = messaging.sender?.id;
      const accountId = entry.id ?? messaging.recipient?.id;

      if (!userId || !accountId) continue;
      if (userId === accountId) continue;

      events.push({
        instagramAccountId: accountId,
        userId,
        watermark: messaging.read.watermark,
      });
    }
  }

  return events;
}

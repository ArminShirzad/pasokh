import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { parseCommentEvents } from '@/lib/meta/webhook';

type InstagramPayload = Parameters<typeof parseCommentEvents>[0];

const envelopeSchema = z.object({
  id: z.string().min(1),
  event: z.string(),
  account: z.object({ id: z.string(), platform: z.literal('instagram') }),
  comment: z.object({
    id: z.string().min(1), platformPostId: z.string().min(1), text: z.string(),
    author: z.object({ id: z.string().min(1), username: z.string().optional() }),
  }).optional(),
  message: z.object({
    platformMessageId: z.string().min(1), direction: z.enum(['incoming', 'outgoing']),
    text: z.string().nullable(), sender: z.object({ id: z.string().min(1), username: z.string().optional() }),
    attachments: z.array(z.object({ type: z.string(), originalType: z.string().optional(), url: z.string().optional() })).optional(),
  }).optional(),
  conversation: z.object({ participantId: z.string().nullish() }).optional(),
  metadata: z.object({
    postbackPayload: z.string().optional(), postbackTitle: z.string().optional(),
    quickReplyPayload: z.string().optional(),
    storyReply: z.object({ storyId: z.string(), storyUrl: z.string().optional() }).optional(),
    isStoryMention: z.boolean().optional(),
  }).nullish(),
  statusAt: z.string().optional(),
});

export function verifyZernioSignature({ rawBody, signature, secret }: {
  rawBody: string; signature: string | null; secret: string;
}): boolean {
  if (!signature || !secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}

export function normalizeZernioEvent({ payload, account }: {
  payload: unknown; account: { zernioAccountId: string | null; instagramId: string };
}): InstagramPayload | null {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success || parsed.data.account.id !== account.zernioAccountId) return null;
  const { event, comment, message, metadata, conversation, statusAt } = parsed.data;
  const entry: InstagramPayload['entry'][number] = { id: account.instagramId, time: Date.now() };
  if (event === 'comment.received' && comment) {
    entry.changes = [{ field: 'comments', value: { id: comment.id, text: comment.text, from: comment.author, media: { id: comment.platformPostId } } }];
  } else if (event === 'message.received' && message?.direction === 'incoming') {
    const sender = { id: message.sender.id, ...(message.sender.username ? { username: message.sender.username } : {}) };
    // Zernio folds Meta's story_mention into type "share"; originalType keeps it.
    const attachments = (message.attachments ?? []).map(a => ({
      type: a.originalType === 'story_mention' ? 'story_mention' : a.type,
      ...(a.url ? { payload: { url: a.url } } : {}),
    }));
    if (metadata?.isStoryMention && !attachments.some(a => a.type === 'story_mention')) attachments.push({ type: 'story_mention' });
    entry.messaging = [metadata?.postbackPayload
      ? { sender, postback: { mid: message.platformMessageId, payload: metadata.postbackPayload, title: metadata.postbackTitle } }
      : { sender, message: {
          mid: message.platformMessageId,
          text: message.text ?? '',
          ...(attachments.length ? { attachments } : {}),
          ...(metadata?.quickReplyPayload ? { quick_reply: { payload: metadata.quickReplyPayload } } : {}),
          ...(metadata?.storyReply ? { reply_to: { story: { id: metadata.storyReply.storyId, url: metadata.storyReply.storyUrl } } } : {}),
        } }];
  } else if (event === 'message.read' && conversation?.participantId) {
    const watermark = statusAt ? Date.parse(statusAt) : undefined;
    entry.messaging = [{ sender: { id: conversation.participantId }, read: { watermark: watermark !== undefined && Number.isFinite(watermark) ? watermark : undefined } }];
  } else {
    return null;
  }
  return { object: 'instagram', entry: [entry] };
}

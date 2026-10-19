import { prisma } from '@/lib/db/client';
import { getBaseUrl } from '@/lib/env';
import type { OutboundMessage } from '@/lib/messages/outbound';

/** Saved messages can outlive a deployment hostname. Only rebase a URL when
 * its random public ID and extension identify an upload in this database.
 * External media and button destinations must retain their original URLs.
 */
export async function resolveUploadedUrl(value: string): Promise<string> {
  let url: URL;
  try { url = new URL(value); } catch { return value; }
  if (!['http:', 'https:'].includes(url.protocol)) return value;
  const match = /^\/media\/([a-f0-9]{48})\.([a-z0-9]+)$/.exec(url.pathname);
  if (!match) return value;
  const current = `${getBaseUrl().replace(/\/$/, '')}${url.pathname}`;
  if (value === current) return value;
  const asset = await prisma.mediaAsset.findUnique({
    where: { publicId: match[1] }, select: { extension: true },
  });
  return asset?.extension === match[2] ? current : value;
}

export async function resolveUploadedMedia(message: OutboundMessage): Promise<OutboundMessage> {
  if (message.type === 'media') return { ...message, url: await resolveUploadedUrl(message.url) };
  if (message.type === 'cards') return {
    ...message,
    cards: await Promise.all(message.cards.map(async card => card.imageUrl
      ? { ...card, imageUrl: await resolveUploadedUrl(card.imageUrl) } : card)),
  };
  return message;
}

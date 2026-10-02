import { prisma } from "@/lib/db/client";

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Records that a person interacted with a connected account. Best effort:
 * contact bookkeeping must never stop a reply from being sent, so failures are
 * logged and swallowed.
 */
export async function touchContact({
  instagramId,
  accountConnectionId,
  igsid,
  username,
  kind,
  at = new Date(),
}: {
  /** The connected account's Instagram id (entry.id), used when the connection id is unknown. */
  instagramId: string;
  accountConnectionId?: string;
  igsid: string;
  username?: string | null;
  kind: "inbound" | "comment";
  at?: Date;
}): Promise<void> {
  try {
    const connectionId =
      accountConnectionId ??
      (await prisma.instagramAccount.findFirst({ where: { instagramId }, select: { id: true } }))?.id;
    if (!connectionId || !igsid || igsid === instagramId) return;
    const stamp = kind === "inbound" ? { lastInboundAt: at } : { lastCommentAt: at };
    await prisma.contact.upsert({
      where: { instagramAccountId_igsid: { instagramAccountId: connectionId, igsid } },
      create: { instagramAccountId: connectionId, igsid, ...(username ? { username } : {}), ...stamp },
      update: { ...(username ? { username } : {}), ...stamp },
    });
  } catch (error) {
    console.error("[contacts] could not record interaction:", error instanceof Error ? error.message : error);
  }
}

/**
 * Whether Instagram still accepts a standard message to this person: within
 * 24 hours of their last message to the account.
 */
export function isInMessagingWindow(lastInboundAt: Date | null | undefined, now = new Date()): boolean {
  return Boolean(lastInboundAt && now.getTime() - lastInboundAt.getTime() < WINDOW_MS);
}

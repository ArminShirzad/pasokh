import { prisma } from "@/lib/db/client";
import { decryptToken } from "@/lib/meta/oauth";
import { ensureWebhook, listWebhooks, webhookUrl } from "./manage-remote";

/**
 * Points every configured Zernio webhook at the current public URL.
 *
 * The public URL changes whenever a quick tunnel restarts, and a webhook still
 * aimed at the old one delivers into nothing: comments and DMs simply stop
 * arriving, with no error anywhere in Pasokh. OpenReply asked the owner to
 * reconnect after each restart; this runs on worker start instead, and only
 * calls Zernio's write endpoint when the stored URL is actually stale.
 */
export async function syncZernioWebhooks(baseUrl: string): Promise<{ checked: number; updated: number; failed: number }> {
  const connections = await prisma.zernioConnection.findMany({
    // A connection without a profile has never registered a webhook.
    where: { profileId: { not: null } },
  });
  let updated = 0;
  let failed = 0;
  for (const connection of connections) {
    try {
      const apiKey = decryptToken(connection.apiKey);
      const expected = webhookUrl({ baseUrl, workspaceId: connection.workspaceId });
      const current = (await listWebhooks(apiKey)).find((w) => w._id === connection.webhookId);
      if (current?.url === expected) continue;
      const webhookId = await ensureWebhook({
        apiKey,
        workspaceId: connection.workspaceId,
        secret: decryptToken(connection.webhookSecret),
        baseUrl,
        webhookId: connection.webhookId,
      });
      await prisma.zernioConnection.update({ where: { workspaceId: connection.workspaceId }, data: { webhookId } });
      await prisma.operationalEvent.create({
        data: {
          workspaceId: connection.workspaceId,
          source: "SYSTEM",
          level: "INFO",
          message: "Zernio webhook re-pointed at the current public URL",
          payload: { from: current?.url ?? null, to: expected },
        },
      });
      updated++;
    } catch (error) {
      failed++;
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: connection.workspaceId,
            source: "SYSTEM",
            level: "ERROR",
            message: "Could not re-point the Zernio webhook at the current public URL",
            payload: { error: error instanceof Error ? error.message : String(error) },
          },
        })
        .catch(() => {});
    }
  }
  return { checked: connections.length, updated, failed };
}

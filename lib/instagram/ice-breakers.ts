import { setIceBreakers as metaSetIceBreakers } from "@/lib/meta/client";
import { zernioRequest } from "@/lib/zernio/client";
import type { InstagramContext } from "./context";

export const MAX_ICE_BREAKERS = 4;
export const ICE_BREAKER_QUESTION_MAX = 80;

/**
 * Replaces the account's ice breakers on Instagram; [] removes them. The test
 * lab reads them from the database, so there is nothing to push for it.
 */
export async function pushIceBreakers(
  context: InstagramContext,
  items: { question: string; payload: string }[]
): Promise<void> {
  if (context.provider === "SIMULATOR") return;
  if (context.provider === "META") return metaSetIceBreakers(context.accessToken, items);
  const path = `/accounts/${encodeURIComponent(context.accountId)}/instagram-ice-breakers`;
  // Zernio's PUT needs at least one; clearing is its own DELETE.
  await zernioRequest({
    apiKey: context.apiKey,
    path,
    method: items.length ? "PUT" : "DELETE",
    ...(items.length ? { body: { ice_breakers: items } } : {}),
  });
}

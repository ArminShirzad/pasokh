import { prisma } from "@/lib/db/client";
import { cleanPublicReplies, publicRepliesProblem } from "./public-replies";

export type CampaignRuleInput = {
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  matchLive: boolean;
  commandId: string | null;
};

/**
 * Rules that depend on more than one field or on the connected account, for
 * the campaign as it will be saved (on an edit: the stored row with the
 * changes applied). Returns the first problem, or null.
 */
export async function campaignProblem(
  input: CampaignRuleInput,
  account: { id: string; provider: string },
): Promise<string | null> {
  const replies = publicRepliesProblem(input.publicReplyEnabled, cleanPublicReplies(input.publicReplyMessages));
  if (replies) return replies;
  if (input.matchLive && account.provider === "ZERNIO") {
    return "Live comments need a Meta connection: Zernio does not forward them.";
  }
  if (input.commandId) {
    const found = await prisma.command.count({
      where: { id: input.commandId, instagramAccountId: account.id },
    });
    if (!found) return "The chosen smart reply does not exist on this Instagram account.";
  }
  return null;
}

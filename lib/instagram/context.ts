import { decryptToken } from "@/lib/meta/oauth";
import { prisma } from "@/lib/db/client";
import type { SimulatorContext } from "@/lib/simulator/provider";

export type InstagramContext =
  | { provider: "META"; accessToken: string }
  | {
      provider: "ZERNIO";
      apiKey: string;
      accountId: string;
      instagramId: string;
      operationId?: string;
    }
  | SimulatorContext;

export type ProviderAccount = {
  /** InstagramAccount.id; the simulator records events against it. */
  id?: string;
  provider: "META" | "ZERNIO" | "SIMULATOR";
  workspaceId: string;
  zernioAccountId: string | null;
  instagramId: string;
  accessToken: string;
};

export function hasInstagramCredentials(
  account: Pick<ProviderAccount, "provider" | "accessToken" | "zernioAccountId">
) {
  if (account.provider === "SIMULATOR") return true;
  return account.provider === "ZERNIO"
    ? Boolean(account.zernioAccountId)
    : Boolean(account.accessToken);
}

export async function createInstagramContext(
  account: ProviderAccount,
  operationId?: string
): Promise<InstagramContext> {
  if (account.provider === "SIMULATOR") {
    if (!account.id) throw new Error("Simulator account row id is required");
    return { provider: "SIMULATOR", connectionId: account.id, instagramId: account.instagramId };
  }
  if (account.provider !== "ZERNIO")
    return { provider: "META", accessToken: decryptToken(account.accessToken) };
  if (!account.zernioAccountId)
    throw new Error("Zernio account is not connected");
  const connection = await prisma.zernioConnection.findUnique({
    where: { workspaceId: account.workspaceId },
    select: { apiKey: true },
  });
  if (!connection) throw new Error("Zernio workspace connection is missing");
  return {
    provider: "ZERNIO",
    apiKey: decryptToken(connection.apiKey),
    accountId: account.zernioAccountId,
    instagramId: account.instagramId,
    ...(operationId ? { operationId } : {}),
  };
}

export type ZernioContext = Extract<InstagramContext, { provider: "ZERNIO" }>;

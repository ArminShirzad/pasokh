import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { validateOutbound, type Card } from "@/lib/messages/outbound";
import { cardCommandIds, cardSchema } from "@/lib/commands/schema";

export const showcaseInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instagramAccountId: z.string().min(1),
  cards: z.array(cardSchema).min(1).max(10),
});

export type ShowcaseInput = z.infer<typeof showcaseInputSchema>;

export function presentShowcase(s: {
  id: string; name: string; instagramAccountId: string; cards: unknown; createdAt: Date; updatedAt: Date;
}) {
  return { id: s.id, name: s.name, instagramAccountId: s.instagramAccountId, cards: s.cards as Card[], createdAt: s.createdAt, updatedAt: s.updatedAt };
}

/**
 * Parses and checks a showcase for a workspace: Instagram's card limits, and
 * buttons that open commands of the same account only. Returns the clean
 * input, or a 400 listing problems by card.
 */
export async function readShowcaseInput(
  request: Request,
  workspaceId: string,
): Promise<{ input: ShowcaseInput } | { response: NextResponse }> {
  const parsed = showcaseInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { response: NextResponse.json({ error: "Invalid showcase", issues: parsed.error.issues }, { status: 400 }) };
  }
  const input = parsed.data;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.instagramAccountId, workspaceId },
    select: { id: true },
  });
  if (!account) return { response: NextResponse.json({ error: "Instagram account not found" }, { status: 404 }) };

  const problems = validateOutbound({ type: "cards", cards: input.cards as Card[] });
  const targets = cardCommandIds(input.cards as Card[]);
  if (targets.length) {
    const found = await prisma.command.count({ where: { id: { in: targets }, instagramAccountId: input.instagramAccountId } });
    if (found !== targets.length) problems.push({ path: "cards", message: "A button points to a command that no longer exists." });
  }
  if (problems.length) return { response: NextResponse.json({ error: "Invalid showcase", problems }, { status: 400 }) };
  return { input };
}

export function showcaseData(input: ShowcaseInput) {
  return { name: input.name, instagramAccountId: input.instagramAccountId, cards: input.cards as Prisma.InputJsonValue };
}

/** Smart replies that show this showcase (their responses reference it). */
export async function commandsUsingShowcase(showcaseId: string, instagramAccountId: string) {
  const commands = await prisma.command.findMany({
    where: { instagramAccountId },
    select: { id: true, name: true, responses: true },
  });
  return commands.filter(
    (c) => Array.isArray(c.responses) && (c.responses as { type?: string; showcaseId?: string }[]).some((r) => r?.type === "showcase" && r.showcaseId === showcaseId),
  );
}

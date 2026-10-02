import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { commandPayload } from "@/lib/commands/engine";
import {
  ICE_BREAKER_QUESTION_MAX,
  MAX_ICE_BREAKERS,
  createInstagramContext,
  pushIceBreakers,
} from "@/lib/instagram/provider";

const codePoints = (s: string) => [...s].length;

export const iceBreakersInputSchema = z.object({
  instagramAccountId: z.string().min(1),
  items: z
    .array(
      z.object({
        question: z.string().trim().min(1).refine((q) => codePoints(q) <= ICE_BREAKER_QUESTION_MAX, {
          message: "Questions can be at most 80 characters.",
        }),
        commandId: z.string().min(1),
      })
    )
    .max(MAX_ICE_BREAKERS),
});

export type IceBreakersInput = z.infer<typeof iceBreakersInputSchema>;

export async function iceBreakerState(instagramAccountId: string) {
  const [items, account] = await Promise.all([
    prisma.iceBreaker.findMany({
      where: { instagramAccountId },
      orderBy: { position: "asc" },
      select: { question: true, commandId: true, command: { select: { name: true, isActive: true } } },
    }),
    prisma.instagramAccount.findUnique({
      where: { id: instagramAccountId },
      select: { iceBreakersSyncedAt: true, iceBreakersError: true },
    }),
  ]);
  return {
    items: items.map((i) => ({ question: i.question, commandId: i.commandId, commandName: i.command.name, commandActive: i.command.isActive })),
    syncedAt: account?.iceBreakersSyncedAt ?? null,
    error: account?.iceBreakersError ?? null,
  };
}

/**
 * Saves the questions, then pushes them to Instagram. They are saved even if
 * the push fails, with the error kept on the account so the page can say that
 * Instagram still shows the previous ones and offer to try again.
 */
export async function saveIceBreakers(input: IceBreakersInput): Promise<{ pushed: boolean }> {
  await prisma.$transaction([
    prisma.iceBreaker.deleteMany({ where: { instagramAccountId: input.instagramAccountId } }),
    prisma.iceBreaker.createMany({
      data: input.items.map((item, position) => ({
        instagramAccountId: input.instagramAccountId,
        position,
        question: item.question,
        commandId: item.commandId,
      })),
    }),
  ]);
  return syncIceBreakers(input.instagramAccountId);
}

export async function syncIceBreakers(instagramAccountId: string): Promise<{ pushed: boolean }> {
  const account = await prisma.instagramAccount.findUniqueOrThrow({ where: { id: instagramAccountId } });
  const items = await prisma.iceBreaker.findMany({ where: { instagramAccountId }, orderBy: { position: "asc" } });
  try {
    const context = await createInstagramContext(account, `icebreakers:${instagramAccountId}`);
    await pushIceBreakers(
      context,
      items.map((i) => ({ question: i.question, payload: commandPayload(i.commandId) }))
    );
    await prisma.instagramAccount.update({
      where: { id: instagramAccountId },
      data: { iceBreakersSyncedAt: new Date(), iceBreakersError: null },
    });
    return { pushed: true };
  } catch (error) {
    await prisma.instagramAccount.update({
      where: { id: instagramAccountId },
      data: { iceBreakersError: (error instanceof Error ? error.message : String(error)).slice(0, 500) },
    });
    return { pushed: false };
  }
}

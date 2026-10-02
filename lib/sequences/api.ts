import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { validateOutbound, type OutboundMessage } from "@/lib/messages/outbound";
import { showcaseIdsOf, type StoredResponse } from "@/lib/messages/stored";
import { referencedCommandIds, responseSchema } from "@/lib/commands/schema";

export const MAX_STEPS = 10;
/** A step can wait up to 7 days; anything later is outside every window anyway. */
export const MAX_DELAY_MINUTES = 7 * 24 * 60;

export const sequenceInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  instagramAccountId: z.string().min(1),
  isActive: z.boolean().default(true),
  stopOnReply: z.boolean().default(true),
  steps: z
    .array(z.object({ delayMinutes: z.number().int().min(0).max(MAX_DELAY_MINUTES), response: responseSchema }))
    .min(1)
    .max(MAX_STEPS),
});

export type SequenceInput = z.infer<typeof sequenceInputSchema>;

export function presentSequence(s: {
  id: string; name: string; instagramAccountId: string; isActive: boolean; stopOnReply: boolean; steps: unknown;
  createdAt: Date; updatedAt: Date;
}, counts?: Record<string, number>) {
  return {
    id: s.id,
    name: s.name,
    instagramAccountId: s.instagramAccountId,
    isActive: s.isActive,
    stopOnReply: s.stopOnReply,
    steps: s.steps,
    enrollments: counts ?? {},
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Enrollment counts by status, per sequence. */
export async function enrollmentCounts(sequenceIds: string[]) {
  const rows = await prisma.sequenceEnrollment.groupBy({
    by: ["sequenceId", "status"],
    where: { sequenceId: { in: sequenceIds } },
    _count: { _all: true },
  });
  const out = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const counts = out.get(row.sequenceId) ?? {};
    counts[row.status] = row._count._all;
    out.set(row.sequenceId, counts);
  }
  return out;
}

export async function readSequenceInput(
  request: Request,
  workspaceId: string,
): Promise<{ input: SequenceInput } | { response: NextResponse }> {
  const parsed = sequenceInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { response: NextResponse.json({ error: "Invalid sequence", issues: parsed.error.issues }, { status: 400 }) };
  }
  const input = parsed.data;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.instagramAccountId, workspaceId },
    select: { id: true },
  });
  if (!account) return { response: NextResponse.json({ error: "Instagram account not found" }, { status: 404 }) };

  const problems: { path: string; message: string }[] = [];
  const responses = input.steps.map((s) => s.response as StoredResponse);
  responses.forEach((response, i) => {
    if (response.type === "showcase") return;
    for (const p of validateOutbound(response as OutboundMessage)) problems.push({ path: `steps[${i}].${p.path}`, message: p.message });
  });
  const targets = referencedCommandIds(responses);
  if (targets.length) {
    const found = await prisma.command.count({ where: { id: { in: targets }, instagramAccountId: input.instagramAccountId } });
    if (found !== targets.length) problems.push({ path: "steps", message: "A button points to a command that no longer exists." });
  }
  const showcases = showcaseIdsOf(responses);
  if (showcases.length) {
    const found = await prisma.showcase.count({ where: { id: { in: showcases }, instagramAccountId: input.instagramAccountId } });
    if (found !== showcases.length) problems.push({ path: "steps", message: "A showcase in this reply no longer exists." });
  }
  if (problems.length) return { response: NextResponse.json({ error: "Invalid sequence", problems }, { status: 400 }) };
  return { input };
}

export function sequenceData(input: SequenceInput) {
  return {
    name: input.name,
    instagramAccountId: input.instagramAccountId,
    isActive: input.isActive,
    stopOnReply: input.stopOnReply,
    steps: input.steps as Prisma.InputJsonValue,
  };
}

import { NextResponse } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { showcaseIdsOf, type StoredResponse } from "@/lib/messages/stored";
import { commandInputSchema, commandProblems, referencedCommandIds, type CommandInput } from "./schema";

export function presentCommand(c: {
  id: string; name: string; instagramAccountId: string; isActive: boolean; matchMode: string; keywords: string[];
  storyScope: string; storyIds: string[]; onStoryMention: boolean; likeTrigger: boolean; responses: unknown; sequenceId?: string | null;
  createdAt: Date; updatedAt: Date; _count?: { runs: number };
}) {
  return {
    id: c.id,
    name: c.name,
    instagramAccountId: c.instagramAccountId,
    isActive: c.isActive,
    matchMode: c.matchMode,
    keywords: c.keywords,
    storyScope: c.storyScope,
    storyIds: c.storyIds,
    onStoryMention: c.onStoryMention,
    likeTrigger: c.likeTrigger,
    responses: c.responses,
    sequenceId: c.sequenceId ?? null,
    runs: c._count?.runs ?? 0,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * Parses and checks a command body for a workspace. Returns either the clean
 * input or a 400 response listing problems the builder can show next to the
 * field they belong to.
 */
export async function readCommandInput(
  request: Request,
  workspaceId: string,
  selfId?: string
): Promise<{ input: CommandInput } | { response: NextResponse }> {
  const parsed = commandInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return { response: NextResponse.json({ error: "Invalid command", issues: parsed.error.issues }, { status: 400 }) };
  }
  const input = parsed.data;
  const account = await prisma.instagramAccount.findFirst({
    where: { id: input.instagramAccountId, workspaceId },
    select: { id: true },
  });
  if (!account) return { response: NextResponse.json({ error: "Instagram account not found" }, { status: 404 }) };

  const problems = commandProblems(input);
  // A menu button may only open a command of the same account; anything else
  // would silently do nothing when tapped.
  const responses = input.responses as StoredResponse[];
  const targets = referencedCommandIds(responses).filter((id) => id !== selfId);
  if (targets.length) {
    const found = await prisma.command.count({ where: { id: { in: targets }, instagramAccountId: input.instagramAccountId } });
    if (found !== targets.length) problems.push({ path: "responses", message: "A button points to a command that no longer exists." });
  }
  // Same for showcases: one of another account would never be sent.
  const showcases = showcaseIdsOf(responses);
  if (showcases.length) {
    const found = await prisma.showcase.count({ where: { id: { in: showcases }, instagramAccountId: input.instagramAccountId } });
    if (found !== showcases.length) problems.push({ path: "responses", message: "A showcase in this reply no longer exists." });
  }
  if (input.sequenceId) {
    const found = await prisma.sequence.count({ where: { id: input.sequenceId, instagramAccountId: input.instagramAccountId } });
    if (!found) problems.push({ path: "sequenceId", message: "The chosen sequence does not exist on this Instagram account." });
  }
  if (problems.length) return { response: NextResponse.json({ error: "Invalid command", problems }, { status: 400 }) };
  return { input };
}

export function commandData(input: CommandInput) {
  return {
    name: input.name,
    instagramAccountId: input.instagramAccountId,
    isActive: input.isActive,
    matchMode: input.matchMode,
    keywords: input.keywords,
    storyScope: input.storyScope,
    storyIds: input.storyScope === "SPECIFIC" ? input.storyIds : [],
    onStoryMention: input.onStoryMention,
    likeTrigger: input.likeTrigger,
    responses: input.responses as Prisma.InputJsonValue,
    sequenceId: input.sequenceId,
  };
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { enrollmentCounts, presentSequence, readSequenceInput, sequenceData } from "@/lib/sequences/api";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function owned(id: string, workspaceId: string) {
  return prisma.sequence.findFirst({ where: { id, workspaceId } });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sequence = await owned((await params).id, context.workspaceId);
  if (!sequence) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [counts, startedBy] = await Promise.all([
    enrollmentCounts([sequence.id]),
    prisma.command.findMany({ where: { sequenceId: sequence.id }, select: { id: true, name: true } }),
  ]);
  return NextResponse.json({ sequence: presentSequence(sequence, counts.get(sequence.id)), startedBy });
}

/** Full update, or `{ isActive }` alone to switch it on or off. */
export async function PUT(request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await owned(id, context.workspaceId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.clone().json().catch(() => null);
  if (body && Object.keys(body).length === 1 && typeof body.isActive === "boolean") {
    const sequence = await prisma.sequence.update({ where: { id }, data: { isActive: body.isActive } });
    return NextResponse.json({ sequence: presentSequence(sequence) });
  }

  const read = await readSequenceInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  // Smart replies start it by id on its account.
  if (read.input.instagramAccountId !== existing.instagramAccountId) {
    return NextResponse.json({ error: "A sequence cannot move to another Instagram account." }, { status: 400 });
  }
  // People part-way through continue from their next step with the new steps.
  const sequence = await prisma.sequence.update({ where: { id }, data: sequenceData(read.input) });
  return NextResponse.json({ sequence: presentSequence(sequence) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owned(id, context.workspaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Smart replies that started it stop doing so (SetNull); people part-way
  // through receive nothing more (their enrollments go with it).
  await prisma.sequence.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

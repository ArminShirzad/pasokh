import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { enrollmentCounts, presentSequence, readSequenceInput, sequenceData } from "@/lib/sequences/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get("accountId");
  const sequences = await prisma.sequence.findMany({
    where: { workspaceId: context.workspaceId, ...(accountId ? { instagramAccountId: accountId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const counts = await enrollmentCounts(sequences.map((s) => s.id));
  return NextResponse.json({ sequences: sequences.map((s) => presentSequence(s, counts.get(s.id))) });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const read = await readSequenceInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  const sequence = await prisma.sequence.create({ data: { workspaceId: context.workspaceId, ...sequenceData(read.input) } });
  return NextResponse.json({ sequence: presentSequence(sequence) }, { status: 201 });
}

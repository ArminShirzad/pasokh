import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { commandData, presentCommand, readCommandInput } from "@/lib/commands/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get("accountId");
  const commands = await prisma.command.findMany({
    where: { workspaceId: context.workspaceId, ...(accountId ? { instagramAccountId: accountId } : {}) },
    include: { _count: { select: { runs: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ commands: commands.map(presentCommand) });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const read = await readCommandInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  const command = await prisma.command.create({ data: { workspaceId: context.workspaceId, ...commandData(read.input) } });
  return NextResponse.json({ command: presentCommand(command) }, { status: 201 });
}

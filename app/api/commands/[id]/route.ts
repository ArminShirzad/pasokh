import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { commandData, presentCommand, readCommandInput } from "@/lib/commands/api";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

async function owned(id: string, workspaceId: string) {
  return prisma.command.findFirst({ where: { id, workspaceId }, include: { _count: { select: { runs: true } } } });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const command = await owned((await params).id, context.workspaceId);
  if (!command) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ command: presentCommand(command) });
}

/** Full update, or `{ isActive }` alone to switch a command on or off. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await owned(id, context.workspaceId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.clone().json().catch(() => null);
  if (body && Object.keys(body).length === 1 && typeof body.isActive === "boolean") {
    const command = await prisma.command.update({ where: { id }, data: { isActive: body.isActive } });
    return NextResponse.json({ command: presentCommand(command) });
  }

  const read = await readCommandInput(request, context.workspaceId, id);
  if ("response" in read) return read.response;
  const command = await prisma.command.update({ where: { id }, data: commandData(read.input) });
  return NextResponse.json({ command: presentCommand(command) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owned(id, context.workspaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // A welcome question on Instagram would answer nothing without it.
  const questions = await prisma.iceBreaker.count({ where: { commandId: id } });
  if (questions) {
    return NextResponse.json({ error: "A welcome question opens this smart reply. Change the question first." }, { status: 409 });
  }
  // Buttons in other commands that opened this one would now do nothing;
  // the builder warns about them via the referencing check on next save.
  await prisma.command.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

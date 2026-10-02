import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { commandsUsingShowcase, presentShowcase, readShowcaseInput, showcaseData } from "@/lib/showcases/api";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function owned(id: string, workspaceId: string) {
  return prisma.showcase.findFirst({ where: { id, workspaceId } });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const showcase = await owned((await params).id, context.workspaceId);
  if (!showcase) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const usedBy = await commandsUsingShowcase(showcase.id, showcase.instagramAccountId);
  return NextResponse.json({ showcase: presentShowcase(showcase), usedBy: usedBy.map((c) => ({ id: c.id, name: c.name })) });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await owned(id, context.workspaceId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const read = await readShowcaseInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  // Smart replies point at it by id on its account; moving it would break them.
  if (read.input.instagramAccountId !== existing.instagramAccountId) {
    return NextResponse.json({ error: "A showcase cannot move to another Instagram account." }, { status: 400 });
  }
  const showcase = await prisma.showcase.update({ where: { id }, data: showcaseData(read.input) });
  return NextResponse.json({ showcase: presentShowcase(showcase) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const existing = await owned(id, context.workspaceId);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Refused while a smart reply shows it: that reply would fail for everyone.
  const usedBy = await commandsUsingShowcase(id, existing.instagramAccountId);
  if (usedBy.length) {
    return NextResponse.json(
      { error: "Smart replies still show this showcase. Remove it from them first.", usedBy: usedBy.map((c) => ({ id: c.id, name: c.name })) },
      { status: 409 },
    );
  }
  await prisma.showcase.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

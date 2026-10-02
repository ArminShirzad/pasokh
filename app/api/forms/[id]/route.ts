import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { formData, readFormInput } from "@/lib/forms/api";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function owned(id: string, workspaceId: string) {
  return prisma.form.findFirst({ where: { id, workspaceId } });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await owned((await params).id, context.workspaceId);
  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const startedBy = await prisma.command.findMany({ where: { formId: form.id }, select: { id: true, name: true } });
  return NextResponse.json({ form, startedBy });
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
    return NextResponse.json({ form: await prisma.form.update({ where: { id }, data: { isActive: body.isActive } }) });
  }
  const read = await readFormInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  if (read.input.instagramAccountId !== existing.instagramAccountId) {
    return NextResponse.json({ error: "A form cannot move to another Instagram account." }, { status: 400 });
  }
  return NextResponse.json({ form: await prisma.form.update({ where: { id }, data: formData(read.input) }) });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await owned(id, context.workspaceId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Its answers go with it; smart replies that started it stop doing so.
  await prisma.form.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

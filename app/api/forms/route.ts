import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { formData, readFormInput } from "@/lib/forms/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = request.nextUrl.searchParams.get("accountId");
  const forms = await prisma.form.findMany({
    where: { workspaceId: context.workspaceId, ...(accountId ? { instagramAccountId: accountId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  const counts = await prisma.formSubmission.groupBy({
    by: ["formId", "status"],
    where: { formId: { in: forms.map((f) => f.id) } },
    _count: { _all: true },
  });
  return NextResponse.json({
    forms: forms.map((f) => ({
      ...f,
      submissions: Object.fromEntries(counts.filter((c) => c.formId === f.id).map((c) => [c.status, c._count._all])),
    })),
  });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const read = await readFormInput(request, context.workspaceId);
  if ("response" in read) return read.response;
  const form = await prisma.form.create({ data: { workspaceId: context.workspaceId, ...formData(read.input) } });
  return NextResponse.json({ form }, { status: 201 });
}

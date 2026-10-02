import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { formResults, resultsCsv } from "@/lib/forms/api";
import type { FormQuestion } from "@/lib/forms/answers";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** ?latest=1 keeps one row per person (the duplicate filter); ?status=COMPLETED; ?format=csv downloads. */
export async function GET(request: NextRequest, { params }: Params) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const form = await prisma.form.findFirst({ where: { id: (await params).id, workspaceId: context.workspaceId } });
  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const search = request.nextUrl.searchParams;
  const rows = await formResults(form.id, {
    latestPerPerson: search.get("latest") === "1",
    status: search.get("status") || undefined,
  });
  const questions = form.questions as FormQuestion[];
  if (search.get("format") === "csv") {
    const name = `form-${form.id}-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(resultsCsv(questions, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
    });
  }
  return NextResponse.json({ form: { id: form.id, name: form.name, questions }, rows });
}

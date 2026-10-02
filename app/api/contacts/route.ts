import { NextResponse, type NextRequest } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { listContacts } from "@/lib/contacts/list";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = request.nextUrl.searchParams;
  const page = Math.max(1, Number(s.get("page")) || 1);
  const result = await listContacts(
    { workspaceId: context.workspaceId, accountId: s.get("accountId"), q: s.get("q"), tag: s.get("tag"), hasPhone: s.get("hasPhone") === "1" },
    { page },
  );
  return NextResponse.json({ ...result, page, pageSize: 50 });
}

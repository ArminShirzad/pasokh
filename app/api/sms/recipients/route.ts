import { NextResponse, type NextRequest } from "next/server";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { recipientsFor } from "@/lib/sms/campaigns";

export const runtime = "nodejs";

/** How many different numbers a filter reaches, before anything is sent. */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = request.nextUrl.searchParams;
  const phones = await recipientsFor(context.workspaceId, { accountId: s.get("accountId"), tag: s.get("tag") });
  return NextResponse.json({ count: phones.length });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { contactWhere } from "@/lib/contacts/list";
import { toCsv } from "@/lib/forms/api";

export const runtime = "nodejs";

/** The filtered contacts as CSV (Excel-safe UTF-8), every page at once. */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = request.nextUrl.searchParams;
  const rows = await prisma.contact.findMany({
    where: contactWhere({ workspaceId: context.workspaceId, accountId: s.get("accountId"), q: s.get("q"), tag: s.get("tag"), hasPhone: s.get("hasPhone") === "1" }),
    include: { instagramAccount: { select: { username: true } } },
    orderBy: { firstSeenAt: "asc" },
    take: 50_000,
  });
  const csv = toCsv(
    ["account", "username", "igsid", "name", "phone", "email", "tags", "first_seen", "last_message", "last_comment"],
    rows.map((c) => [
      c.instagramAccount.username,
      c.username ?? "",
      c.igsid,
      c.name ?? "",
      c.phone ?? "",
      c.email ?? "",
      c.tags.join(" "),
      c.firstSeenAt.toISOString(),
      c.lastInboundAt?.toISOString() ?? "",
      c.lastCommentAt?.toISOString() ?? "",
    ]),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

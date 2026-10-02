import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { defaultLocale } from "@/lib/i18n";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { TEMPLATE_KEYS, applyTemplate, hrefFor } from "@/lib/templates/catalog";

export const runtime = "nodejs";

const schema = z.object({ key: z.enum(TEMPLATE_KEYS), instagramAccountId: z.string().min(1) });

/** Creates a template's objects, paused, and says where to review each. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const account = await prisma.instagramAccount.findFirst({
    where: { id: parsed.data.instagramAccountId, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!account) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
  // The copy goes to followers, so it follows the instance language.
  const created = await applyTemplate(parsed.data.key, { workspaceId: context.workspaceId, instagramAccountId: account.id, locale: defaultLocale() });
  return NextResponse.json({ created: created.map((c) => ({ ...c, href: hrefFor(c) })) }, { status: 201 });
}

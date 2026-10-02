import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { campaignCounts, createSmsCampaign } from "@/lib/sms/campaigns";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
  accountId: z.string().min(1).nullable().optional(),
  tag: z.string().min(1).nullable().optional(),
});

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const campaigns = await prisma.smsCampaign.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const counts = await campaignCounts(campaigns.map((c) => c.id));
  return NextResponse.json({ campaigns: campaigns.map((c) => ({ ...c, counts: counts.get(c.id) ?? {} })) });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { accountId, ...rest } = parsed.data;
  if (accountId) {
    const account = await prisma.instagramAccount.findFirst({ where: { id: accountId, workspaceId: context.workspaceId }, select: { id: true } });
    if (!account) return NextResponse.json({ error: "Instagram account not found" }, { status: 404 });
  }
  try {
    const campaign = await createSmsCampaign({ workspaceId: context.workspaceId, ...rest, filter: { accountId, tag: rest.tag } });
    return NextResponse.json({ campaign }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not start the send." }, { status: 400 });
  }
}

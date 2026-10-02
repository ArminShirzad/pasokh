import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const runtime = "nodejs";

/** Stops a send: messages not yet claimed are not sent. A batch already at the provider finishes. */
export async function PATCH(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Only owners and admins can change this" }, { status: 403 });
  const { id } = await params;
  const campaign = await prisma.smsCampaign.findFirst({ where: { id, workspaceId: context.workspaceId } });
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (campaign.status === "DONE" || campaign.status === "STOPPED") return NextResponse.json({ campaign });
  await prisma.smsMessage.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "FAILED", error: "Not sent: the send was stopped" } });
  const updated = await prisma.smsCampaign.update({ where: { id }, data: { status: "STOPPED", stopReason: "Stopped by you" } });
  return NextResponse.json({ campaign: updated });
}

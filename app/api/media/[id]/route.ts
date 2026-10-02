import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { deleteMediaFile } from "@/lib/media/store";

export const runtime = "nodejs";

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // Scoped to the caller's workspace: another workspace's id is simply not found.
  const asset = await prisma.mediaAsset.findFirst({ where: { id, workspaceId: context.workspaceId } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.mediaAsset.delete({ where: { id: asset.id } });
  await deleteMediaFile(asset.publicId, asset.extension);
  return NextResponse.json({ success: true });
}

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { checkUpload, cleanFileName, mediaUrl, newPublicId, writeMediaFile } from "@/lib/media/store";

export const runtime = "nodejs";

function present(asset: {
  id: string; publicId: string; kind: string; mimeType: string; extension: string; fileName: string; sizeBytes: number; createdAt: Date;
}) {
  return {
    id: asset.id,
    kind: asset.kind,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt,
    url: mediaUrl(asset),
  };
}

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const assets = await prisma.mediaAsset.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ assets: assets.map(present) });
}

/** multipart/form-data with one `file` field. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    file = null;
  }
  if (!file) return NextResponse.json({ error: "Choose a file to upload." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const checked = checkUpload(bytes);
  if ("problem" in checked) return NextResponse.json({ error: checked.problem }, { status: 400 });

  const publicId = newPublicId();
  await writeMediaFile(publicId, checked.format.extension, bytes);
  const asset = await prisma.mediaAsset.create({
    data: {
      workspaceId: context.workspaceId,
      publicId,
      kind: checked.format.kind,
      mimeType: checked.format.mimeType,
      extension: checked.format.extension,
      fileName: cleanFileName(file.name),
      sizeBytes: bytes.length,
    },
  });
  return NextResponse.json({ asset: present(asset) }, { status: 201 });
}

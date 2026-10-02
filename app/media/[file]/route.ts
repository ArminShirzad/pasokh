import { prisma } from "@/lib/db/client";
import { isPublicId, readMediaFile } from "@/lib/media/store";

export const runtime = "nodejs";

/**
 * Public: Instagram (directly or through Zernio) downloads DM attachments from
 * here, without any session. Only files registered as MediaAsset are served,
 * looked up by their random publicId, so nothing else on disk is reachable.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const match = /^([a-f0-9]+)\.([a-z0-9]{2,4})$/.exec(file);
  if (!match || !isPublicId(match[1])) return new Response("Not found", { status: 404 });
  const asset = await prisma.mediaAsset.findUnique({ where: { publicId: match[1] } });
  if (!asset || asset.extension !== match[2]) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readMediaFile(asset.publicId, asset.extension);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(bytes.length),
      // Content at a publicId never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

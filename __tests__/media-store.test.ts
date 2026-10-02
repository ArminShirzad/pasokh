import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ assets: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    mediaAsset: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `asset_${db.assets.length + 1}`, createdAt: new Date(), ...data };
        db.assets.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { publicId: string } }) => db.assets.find((a) => a.publicId === where.publicId) ?? null,
      findMany: async () => db.assets,
    },
  },
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: async () => ({ userId: "u", workspaceId: "ws1", role: "OWNER" }),
}));

import { checkUpload, isPublicId, mediaUrl, newPublicId, sniffFormat } from "../lib/media/store";
import { POST } from "../app/api/media/route";
import { GET as serve } from "../app/media/[file]/route";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const m4a = new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypM4A "), 0, 0]);
const mp4 = new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), 0, 0]);
const pdf = new Uint8Array(Buffer.from("%PDF-1.7\n"));
const html = new Uint8Array(Buffer.from("<html><script>alert(1)</script>"));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "pasokh-media-"));
  process.env.PASOKH_DATA_DIR = dir;
  process.env.PASOKH_PUBLIC_URL = "https://pasokh.example";
});
afterAll(async () => {
  delete process.env.PASOKH_DATA_DIR;
  delete process.env.PASOKH_PUBLIC_URL;
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => {
  db.assets = [];
});

function upload(bytes: Uint8Array, name: string, type = "application/octet-stream") {
  const form = new FormData();
  form.append("file", new File([bytes as BlobPart], name, { type }));
  return POST(new Request("http://localhost/api/media", { method: "POST", body: form }) as never);
}

describe("media type detection", () => {
  it("recognises formats by their bytes", () => {
    expect(sniffFormat(jpeg)?.extension).toBe("jpg");
    expect(sniffFormat(png)?.extension).toBe("png");
    expect(sniffFormat(m4a)).toMatchObject({ kind: "audio", extension: "m4a" });
    expect(sniffFormat(mp4)).toMatchObject({ kind: "video", extension: "mp4" });
    expect(sniffFormat(pdf)?.kind).toBe("file");
  });

  it("refuses a page disguised as an image, which this server would otherwise publish", () => {
    expect(checkUpload(html)).toEqual({
      problem: "This file type cannot be sent on Instagram. Use JPG, PNG, GIF, MP4, MOV, M4A, WAV, AAC or PDF.",
    });
  });

  it("applies Instagram's limits: 8 MB for images, 25 MB for the rest", () => {
    const bigImage = new Uint8Array(8 * 1024 * 1024 + 1);
    bigImage.set(jpeg);
    expect(checkUpload(bigImage)).toEqual({ problem: "Images can be at most 8 MB." });
    const video = new Uint8Array(20 * 1024 * 1024);
    video.set(mp4);
    expect("format" in checkUpload(video)).toBe(true);
  });

  it("makes public ids long and random enough not to be guessed or enumerated", () => {
    const a = newPublicId();
    expect(isPublicId(a)).toBe(true);
    expect(a).not.toBe(newPublicId());
    expect(isPublicId("../../etc/passwd")).toBe(false);
    expect(mediaUrl({ publicId: a, extension: "jpg" })).toBe(`https://pasokh.example/media/${a}.jpg`);
  });
});

describe("upload and public serving", () => {
  it("stores the file under the detected type, whatever the browser claimed", async () => {
    const response = await upload(png, "photo.jpg", "image/jpeg");
    expect(response.status).toBe(201);
    const { asset } = await response.json();
    expect(asset).toMatchObject({ kind: "image", mimeType: "image/png", fileName: "photo.jpg" });
    expect(asset.url).toMatch(/^https:\/\/pasokh\.example\/media\/[a-f0-9]{48}\.png$/);

    const file = asset.url.split("/").pop();
    const served = await serve(new Request(asset.url), { params: Promise.resolve({ file }) });
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(png);
  });

  it("rejects an unsupported upload without writing anything to disk", async () => {
    const before = (await readdir(path.join(dir, "media")).catch(() => [])).length;
    const response = await upload(html, "x.png", "image/png");
    expect(response.status).toBe(400);
    expect((await readdir(path.join(dir, "media")).catch(() => [])).length).toBe(before);
  });

  it("serves nothing for an unknown id, a wrong extension, or a path", async () => {
    const response = await upload(jpeg, "a.jpg");
    const { asset } = await response.json();
    const id = asset.url.split("/").pop().split(".")[0];
    for (const file of [`${newPublicId()}.jpg`, `${id}.png`, "..%2F..%2Fetc%2Fpasswd", "x.jpg"]) {
      const served = await serve(new Request("http://x"), { params: Promise.resolve({ file }) });
      expect(served.status).toBe(404);
    }
  });
});

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBaseUrl } from "@/lib/env";
import type { MediaType } from "@/lib/messages/outbound";

/**
 * Uploaded DM attachments, on local disk (a Docker volume at /app/data).
 *
 * The type is decided from the file's first bytes, never from its name or the
 * browser's Content-Type: the file is served publicly from this server, so an
 * upload claiming to be an image must actually be one. Size limits are
 * Instagram's attachment limits (images 8 MB; video, audio, PDF 25 MB), so a
 * file that saves will also send.
 */

type Format = { kind: MediaType; mimeType: string; extension: string; maxBytes: number };

const MB = 1024 * 1024;
const FORMATS = {
  jpg: { kind: "image", mimeType: "image/jpeg", extension: "jpg", maxBytes: 8 * MB },
  png: { kind: "image", mimeType: "image/png", extension: "png", maxBytes: 8 * MB },
  gif: { kind: "image", mimeType: "image/gif", extension: "gif", maxBytes: 8 * MB },
  mp4: { kind: "video", mimeType: "video/mp4", extension: "mp4", maxBytes: 25 * MB },
  mov: { kind: "video", mimeType: "video/quicktime", extension: "mov", maxBytes: 25 * MB },
  m4a: { kind: "audio", mimeType: "audio/mp4", extension: "m4a", maxBytes: 25 * MB },
  wav: { kind: "audio", mimeType: "audio/wav", extension: "wav", maxBytes: 25 * MB },
  aac: { kind: "audio", mimeType: "audio/aac", extension: "aac", maxBytes: 25 * MB },
  pdf: { kind: "file", mimeType: "application/pdf", extension: "pdf", maxBytes: 25 * MB },
} satisfies Record<string, Format>;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((b, i) => bytes[offset + i] === b);
}
function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Identifies a supported format from the file's leading bytes, or null. */
export function sniffFormat(bytes: Uint8Array): Format | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return FORMATS.jpg;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return FORMATS.png;
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return FORMATS.gif;
  if (ascii(bytes, 0, 5) === "%PDF-") return FORMATS.pdf;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") return FORMATS.wav;
  // ADTS AAC: 12-bit sync word 0xFFF, layer bits 00.
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return FORMATS.aac;
  // ISO base media (MP4 family): "ftyp" at offset 4; the brand tells audio from video.
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (brand === "M4A " || brand === "M4B ") return FORMATS.m4a;
    if (brand === "qt  ") return FORMATS.mov;
    return FORMATS.mp4;
  }
  return null;
}

export type MediaProblem =
  | "This file type cannot be sent on Instagram. Use JPG, PNG, GIF, MP4, MOV, M4A, WAV, AAC or PDF."
  | "Images can be at most 8 MB."
  | "Videos, audio and files can be at most 25 MB."
  | "The file is empty.";

export function checkUpload(bytes: Uint8Array): { format: Format } | { problem: MediaProblem } {
  if (bytes.length === 0) return { problem: "The file is empty." };
  const format = sniffFormat(bytes);
  if (!format) return { problem: "This file type cannot be sent on Instagram. Use JPG, PNG, GIF, MP4, MOV, M4A, WAV, AAC or PDF." };
  if (bytes.length > format.maxBytes) {
    return { problem: format.kind === "image" ? "Images can be at most 8 MB." : "Videos, audio and files can be at most 25 MB." };
  }
  return { format };
}

export function mediaDir(): string {
  return path.join(process.env.PASOKH_DATA_DIR ?? path.join(process.cwd(), "data"), "media");
}

/** 24 random bytes as hex: the only thing standing between a file and a stranger. */
export function newPublicId(): string {
  return randomBytes(24).toString("hex");
}

const PUBLIC_ID = /^[a-f0-9]{48}$/;

export function isPublicId(value: string): boolean {
  return PUBLIC_ID.test(value);
}

function filePath(publicId: string, extension: string): string {
  if (!isPublicId(publicId) || !/^[a-z0-9]{2,4}$/.test(extension)) throw new Error("Invalid media id");
  return path.join(mediaDir(), `${publicId}.${extension}`);
}

export async function writeMediaFile(publicId: string, extension: string, bytes: Uint8Array): Promise<void> {
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(filePath(publicId, extension), bytes, { flag: "wx" });
}

export async function readMediaFile(publicId: string, extension: string): Promise<Buffer> {
  return readFile(filePath(publicId, extension));
}

export async function deleteMediaFile(publicId: string, extension: string): Promise<void> {
  await rm(filePath(publicId, extension), { force: true });
}

/** The address Instagram fetches the attachment from. */
export function mediaUrl(asset: { publicId: string; extension: string }, baseUrl = getBaseUrl()): string {
  return `${baseUrl.replace(/\/$/, "")}/media/${asset.publicId}.${asset.extension}`;
}

/** Display names only; never used as a path. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, "").slice(0, 120) || "file";
}

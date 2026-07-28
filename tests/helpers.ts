import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageSession } from "@/lib/sessions";

/**
 * Minimal byte blobs that satisfy the magic-number checks in `sessions.ts`.
 * The pixels never matter: nothing under test decodes them.
 */
export function jpegBytes(size = 64) {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

export function pngBytes(size = 64) {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  return bytes;
}

export function webpBytes(size = 64) {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WEBP", 8, "ascii");
  return bytes;
}

export function imageFile(
  bytes: Buffer = jpegBytes(),
  type = "image/jpeg",
  name = "portrait.jpg",
) {
  return new File([new Uint8Array(bytes)], name, { type });
}

function metadataPath(id: string) {
  return path.join(process.env.BLOOM_DATA_DIR!, id, "session.json");
}

export async function readMetadata(id: string) {
  return JSON.parse(await readFile(metadataPath(id), "utf8")) as ImageSession;
}

/** Edit stored metadata directly to simulate states the API cannot produce. */
export async function patchMetadata(
  id: string,
  changes: Partial<ImageSession>,
) {
  const current = await readMetadata(id);
  const next = { ...current, ...changes };
  await writeFile(metadataPath(id), JSON.stringify(next, null, 2));
  return next;
}

export function expiredAt() {
  return new Date(Date.now() - 1000).toISOString();
}

export function routeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

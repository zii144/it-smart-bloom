import { randomBytes } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { ImageGenerationOptions } from "@/lib/image-options";

export const SESSION_TTL_MS = 15 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type SessionStatus = "ready" | "generating" | "complete" | "failed";

export type ImageSession = {
  id: string;
  createdAt: string;
  expiresAt: string;
  status: SessionStatus;
  inputMime: string;
  resultMime?: string;
  error?: string;
  generationStartedAt?: string;
  generationOptions?: ImageGenerationOptions;
  identity?: {
    kind: "lineId" | "mobile";
    value: string;
    claimedAt: string;
  };
};

function sessionsRoot() {
  return process.env.BLOOM_DATA_DIR
    ? path.resolve(process.env.BLOOM_DATA_DIR)
    : path.join(process.cwd(), ".data", "sessions");
}

function assertSessionId(id: string) {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new SessionError("找不到這個創作空間。", 404);
  }
}

function sessionDirectory(id: string) {
  assertSessionId(id);
  return path.join(sessionsRoot(), id);
}

function metadataPath(id: string) {
  return path.join(sessionDirectory(id), "session.json");
}

function inputPath(id: string) {
  return path.join(sessionDirectory(id), "input");
}

function outputPath(id: string) {
  return path.join(sessionDirectory(id), "result");
}

async function writeMetadata(session: ImageSession) {
  const target = metadataPath(session.id);
  const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(session, null, 2));
  await rename(temporary, target);
}

function hasExpectedSignature(bytes: Buffer, mime: string) {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mime === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }

  if (mime === "image/webp") {
    return (
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }

  return false;
}

export class SessionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export async function createSession(
  file: File,
  generationOptions?: ImageGenerationOptions,
) {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new SessionError("請使用 JPEG、PNG 或 WebP 格式的照片。", 415);
  }

  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new SessionError("照片大小必須小於 12 MB。", 413);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (!hasExpectedSignature(bytes, file.type)) {
    throw new SessionError("上傳的檔案不是有效的圖片。", 400);
  }

  const id = randomBytes(24).toString("base64url");
  const createdAt = new Date();
  const session: ImageSession = {
    id,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS).toISOString(),
    status: "ready",
    inputMime: file.type,
    ...(generationOptions ? { generationOptions } : {}),
  };

  await mkdir(sessionDirectory(id), { recursive: true });
  await writeFile(inputPath(id), bytes);
  await writeMetadata(session);

  return session;
}

export async function getSession(id: string) {
  try {
    const session = JSON.parse(
      await readFile(metadataPath(id), "utf8"),
    ) as ImageSession;

    return session;
  } catch (error) {
    if (error instanceof SessionError) {
      throw error;
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      throw new SessionError("找不到這個創作空間。", 404);
    }

    throw error;
  }
}

export async function updateSession(
  id: string,
  changes: Partial<Omit<ImageSession, "id" | "createdAt" | "expiresAt">>,
) {
  const current = await getSession(id);
  const next = { ...current, ...changes };
  await writeMetadata(next);
  return next;
}

export async function readInputImage(id: string) {
  const session = await getSession(id);
  return {
    bytes: await readFile(inputPath(id)),
    mime: session.inputMime,
  };
}

export async function writeResultImage(
  id: string,
  bytes: Buffer,
  mime: string,
) {
  await writeFile(outputPath(id), bytes);
  return updateSession(id, {
    status: "complete",
    resultMime: mime,
    error: undefined,
  });
}

export async function readResultImage(id: string) {
  const session = await getSession(id);
  if (session.status !== "complete" || !session.resultMime) {
    throw new SessionError("專屬人像仍在創作中。", 409);
  }

  try {
    const fileInfo = await stat(outputPath(id));
    return {
      bytes: await readFile(outputPath(id)),
      mime: session.resultMime,
      size: fileInfo.size,
    };
  } catch {
    throw new SessionError("目前無法取得專屬人像。", 404);
  }
}

/**
 * Photos are archived to Firebase for the long term. Local disk cleanup is no
 * longer tied to a 15-minute guest promise; keep this helper for ops scripts.
 */
export async function purgeExpiredSessions(now = Date.now()) {
  const root = sessionsRoot();

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isDirectory() || !SESSION_ID_PATTERN.test(entry.name)) return;

      const directory = path.join(root, entry.name);
      if (!(await isExpiredSessionDirectory(directory, now))) return;

      await rm(directory, { recursive: true, force: true });
      removed += 1;
    }),
  );

  return removed;
}

async function isExpiredSessionDirectory(directory: string, now: number) {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(directory, "session.json"), "utf8"),
    ) as ImageSession;
    return Date.parse(metadata.expiresAt) <= now;
  } catch {
    const info = await stat(directory).catch(() => null);
    return info ? now - info.mtimeMs > SESSION_TTL_MS : false;
  }
}

export function publicSession(session: ImageSession) {
  return {
    id: session.id,
    status: session.status,
    createdAt: session.createdAt,
    startedAt: session.generationStartedAt ?? null,
    expiresAt: session.expiresAt,
    inputUrl: `/api/sessions/${session.id}/image?kind=input`,
    resultUrl:
      session.status === "complete"
        ? `/api/sessions/${session.id}/image?kind=result`
        : null,
    error:
      session.status === "failed"
        ? "無法完成這次創作，請回到拍照裝置後再試一次。"
        : null,
    generationOptions: session.generationOptions ?? null,
    identity: session.identity
      ? {
          kind: session.identity.kind,
          value: session.identity.value,
          claimedAt: session.identity.claimedAt,
        }
      : null,
  };
}

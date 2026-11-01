import {
  previewObjectPath,
  readArchiveImage,
  readArchiveRecord,
  signedDownloadUrl,
  storePreview,
} from "@/lib/portrait-archive";
import { FUNCTION_BODY_SAFE_BYTES } from "@/lib/portrait-limits";
import { compressPreview, PREVIEW_MIME } from "@/lib/portrait-preview";
import {
  extensionForMime,
  getSession,
  readInputImage,
  readResultImage,
  readSessionCache,
  SessionError,
  writeSessionCache,
} from "@/lib/sessions";

/**
 * Everything a function hands a browser goes through here, because Vercel
 * caps a function response at 4.5 MB:
 *
 * - previews are compressed JPEGs, always safe to stream;
 * - an original is streamed only when it fits, otherwise the browser is
 *   redirected to a short-lived signed Storage URL.
 *
 * `deliverable` is what guests receive (the admin's adjustment if any);
 * `generated` is the model's own output, for the admin to compare.
 */
export type PortraitVariant = "deliverable" | "generated";

type DeliveryOptions = {
  /** Admin only: serve an archived result even if a later retry left the session unfinished. */
  allowIncomplete?: boolean;
};

/** Which bytes to serve, resolved once so the preview key and the bytes always match. */
type PortraitSource = {
  /** Names the preview; changes whenever the underlying image does. */
  key: string;
  isFinal: boolean;
  /** Storage object; null when only this instance's local copy exists. */
  objectPath: string | null;
  previewPath: string | null;
  mime: string;
  /** Known for admin uploads only. */
  size: number | null;
};

const NO_STORE = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** A retry overwrites `result` in place, so its preview is keyed by when it was written. */
function generatedKey(resultAt: string | null | undefined) {
  const written = Date.parse(resultAt ?? "");
  return Number.isFinite(written) ? `generated-${written.toString(36)}` : "generated";
}

async function resolveSource(
  sessionId: string,
  variant: PortraitVariant,
  { allowIncomplete = false }: DeliveryOptions = {},
): Promise<PortraitSource> {
  const record = await readArchiveRecord(sessionId);
  const final = variant === "deliverable" ? record?.finalResult : null;
  if (final?.path) {
    return {
      key: `final-${final.revisionId}`,
      isFinal: true,
      objectPath: final.path,
      previewPath: final.previewPath ?? null,
      mime: final.mime,
      size: typeof final.size === "number" ? final.size : null,
    };
  }

  const resultPath = record?.storage.resultPath;
  if (
    record &&
    resultPath &&
    ((record.status === "complete" && record.resultMime) || allowIncomplete)
  ) {
    return {
      key: generatedKey(record.resultAt),
      isFinal: false,
      objectPath: resultPath,
      previewPath: null,
      mime: record.resultMime ?? "image/jpeg",
      size: null,
    };
  }

  // No archive (Firebase off), or it lags behind this instance's own render.
  const session = await getSession(sessionId);
  if (session.status !== "complete" || !session.resultMime) {
    throw new SessionError("專屬人像仍在創作中。", 409);
  }
  return {
    key: generatedKey(session.resultAt),
    isFinal: false,
    objectPath: null,
    previewPath: null,
    mime: session.resultMime,
    size: null,
  };
}

async function readSourceBytes(sessionId: string, source: PortraitSource) {
  if (source.objectPath) {
    const archived = await readArchiveImage(source.objectPath);
    if (archived) return archived.bytes;
    // Never fall back to the image an admin replaced.
    if (source.isFinal) throw new SessionError("目前無法取得專屬人像。", 503);
  }
  return (await readResultImage(sessionId)).bytes;
}

/** The compressed portrait, built once per image and cached in Storage and /tmp. */
export async function readPortraitPreview(
  sessionId: string,
  variant: PortraitVariant = "deliverable",
  options?: DeliveryOptions,
): Promise<Buffer> {
  const source = await resolveSource(sessionId, variant, options);
  const cacheName = `preview-${source.key}.jpg`;

  const cached = await readSessionCache(sessionId, cacheName);
  if (cached) return cached;

  if (source.objectPath) {
    const stored = await readArchiveImage(
      source.previewPath ?? previewObjectPath(sessionId, source.key),
      { missingOk: true },
    );
    if (stored) {
      await writeSessionCache(sessionId, cacheName, stored.bytes);
      return stored.bytes;
    }
  }

  const preview = await compressPreview(await readSourceBytes(sessionId, source));
  await writeSessionCache(sessionId, cacheName, preview);
  if (source.objectPath) await storePreview(sessionId, source.key, preview);
  return preview;
}

/** The booth photo, compressed; it was cropped small, but 12 MB uploads are allowed. */
export async function readInputPreview(sessionId: string): Promise<Buffer> {
  const cached = await readSessionCache(sessionId, "preview-input.jpg");
  if (cached) return cached;
  const preview = await compressPreview((await readInputImage(sessionId)).bytes);
  await writeSessionCache(sessionId, "preview-input.jpg", preview);
  return preview;
}

export function previewResponse(bytes: Buffer, filename = "zhisheng-bloom-portrait.jpg") {
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": PREVIEW_MIME,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}

/**
 * The full-quality portrait as a download: streamed when it fits in a
 * function response, otherwise a redirect to a signed Storage URL.
 */
export async function originalDownloadResponse(
  sessionId: string,
  variant: PortraitVariant = "deliverable",
  options?: DeliveryOptions,
) {
  const source = await resolveSource(sessionId, variant, options);
  const filename = `zhisheng-bloom-portrait.${extensionForMime(source.mime)}`;

  // A big adjusted original is never pulled into the function just to find out.
  let bytes: Buffer | null = null;
  if (source.size === null || source.size <= FUNCTION_BODY_SAFE_BYTES) {
    bytes = await readSourceBytes(sessionId, source);
    if (bytes.length <= FUNCTION_BODY_SAFE_BYTES) {
      return streamDownload(bytes, source.mime, filename);
    }
  }

  const url = source.objectPath
    ? await signedDownloadUrl(source.objectPath, { filename, mime: source.mime })
    : null;
  if (url) {
    return new Response(null, {
      status: 302,
      headers: { ...NO_STORE, Location: url },
    });
  }

  // Off Vercel (local dev, emulators) there is no body cap to dodge.
  if (!process.env.VERCEL) {
    bytes ??= await readSourceBytes(sessionId, source);
    return streamDownload(bytes, source.mime, filename);
  }
  throw new SessionError("原圖暫時無法下載，請稍後再試或洽現場工作人員。", 503);
}

function streamDownload(bytes: Buffer, mime: string, filename: string) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...NO_STORE,
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

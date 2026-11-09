import { randomBytes } from "node:crypto";
import type { GuestIdentity } from "@/lib/guest-identity";
import { identityStorageKey } from "@/lib/guest-identity";
import {
  getBucket,
  getDb,
  isFirebaseConfigured,
  isFirebaseEmulator,
} from "@/lib/firebase-admin";
import {
  isAdjustedMime,
  MAX_ADJUSTED_BYTES,
  type AdjustedMime,
} from "@/lib/portrait-limits";
import { compressPreview, PREVIEW_MIME, PreviewError } from "@/lib/portrait-preview";
import { recordRosterPortrait } from "@/lib/roster-store";
import { hasExpectedSignature } from "@/lib/image-signature";
import {
  createCompleteSession,
  getSession,
  isSessionId,
  writeResultImage,
  type ImageSession,
  type SessionStatus,
} from "@/lib/sessions";

/**
 * An admin's fine-tuned replacement for the generated portrait. Each upload is
 * a new object under `sessions/{id}/final/`; the generated `result` is never
 * overwritten, so clearing this goes back to it.
 */
export type FinalResult = {
  path: string;
  mime: string;
  revisionId: string;
  uploadedAt: string;
  /** Bytes of the original; decides between streaming and a signed URL. */
  size: number;
  /** The compressed copy guests are shown, made when the upload is accepted. */
  previewPath: string | null;
};

export type ArchiveRecord = {
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string | null;
  updatedAt: string;
  generationStartedAt: string | null;
  generationAttempts: number | null;
  error: string | null;
  inputMime: string;
  resultMime: string | null;
  /** Absent on records from before previews were keyed by result. */
  resultAt?: string | null;
  source: ImageSession["source"] | null;
  generationOptions: ImageSession["generationOptions"] | null;
  rosterEntryId: string | null;
  identityKind: GuestIdentity["kind"] | null;
  identityValue: string | null;
  identityKey: string | null;
  claimedAt: string | null;
  avatarRequestedAt: string | null;
  avatarRequestStatus: "idle" | "success" | "failed" | null;
  avatarRequestError: string | null;
  /** Absent or null: guests get the generated result. */
  finalResult?: FinalResult | null;
  storage: {
    inputPath: string | null;
    resultPath: string | null;
    identityInputPath: string | null;
    identityResultPath: string | null;
  };
};

function sessionDoc(sessionId: string) {
  const db = getDb();
  if (!db) return null;
  return db.collection("sessions").doc(sessionId);
}

/**
 * Best effort: the roster's portrait column is a convenience for the admin
 * check-in view and must never fail the session it describes.
 */
async function mirrorPortraitToRoster(session: ImageSession, isNewSession: boolean) {
  if (!session.rosterEntryId) return;
  try {
    await recordRosterPortrait(session.rosterEntryId, session.id, session.status, {
      isNewSession,
    });
  } catch (error) {
    console.error("Failed to mirror portrait status to roster:", error);
  }
}

function identityDoc(identityKey: string) {
  const db = getDb();
  if (!db) return null;
  return db.collection("identities").doc(identityKey);
}

async function uploadBytes(
  objectPath: string,
  bytes: Buffer,
  mime: string,
): Promise<string | null> {
  const bucket = getBucket();
  if (!bucket) return null;

  try {
    const file = bucket.file(objectPath);
    await file.save(bytes, {
      resumable: false,
      contentType: mime,
      metadata: { cacheControl: "private, max-age=0" },
    });
    return objectPath;
  } catch (error) {
    console.error(`Firebase Storage upload failed for ${objectPath}:`, error);
    return null;
  }
}

export async function archiveSessionCreated(session: ImageSession, input: {
  bytes: Buffer;
  mime: string;
}) {
  if (!isFirebaseConfigured()) return;

  const inputPath = await uploadBytes(
    `sessions/${session.id}/input`,
    input.bytes,
    input.mime,
  );
  const identity = session.identity;
  const identityKey = identity
    ? identityStorageKey({ kind: identity.kind, value: identity.value })
    : null;
  const identityInputPath = identityKey
    ? await uploadBytes(
        `identities/${identityKey}/${session.id}/input`,
        input.bytes,
        input.mime,
      )
    : null;

  const now = new Date().toISOString();
  const record: ArchiveRecord = {
    sessionId: session.id,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    updatedAt: now,
    generationStartedAt: session.generationStartedAt ?? null,
    generationAttempts: session.generationAttempts ?? 0,
    error: session.error ?? null,
    inputMime: session.inputMime,
    resultMime: session.resultMime ?? null,
    resultAt: session.resultAt ?? null,
    source: session.source ?? null,
    generationOptions: session.generationOptions ?? null,
    rosterEntryId: session.rosterEntryId ?? null,
    identityKind: identity?.kind ?? null,
    identityValue: identity?.value ?? null,
    identityKey,
    claimedAt: identity?.claimedAt ?? null,
    avatarRequestedAt: null,
    avatarRequestStatus: "idle",
    avatarRequestError: null,
    storage: {
      inputPath,
      resultPath: null,
      identityInputPath,
      identityResultPath: null,
    },
  };

  await sessionDoc(session.id)?.set(record, { merge: true });
  await mirrorPortraitToRoster(session, true);

  if (identity && identityKey) {
    const ref = identityDoc(identityKey);
    const previous = await ref?.get();
    const previousIds =
      (previous?.data()?.sessionIds as string[] | undefined) ?? [];
    await ref?.set(
      {
        kind: identity.kind,
        value: identity.value,
        updatedAt: now,
        sessionIds: Array.from(new Set([...previousIds, session.id])),
      },
      { merge: true },
    );
  }
}

export async function archiveSessionStatus(
  session: ImageSession,
  result?: { bytes: Buffer; mime: string } | null,
) {
  if (!isFirebaseConfigured()) return;

  const doc = sessionDoc(session.id);
  if (!doc) return;

  const existing = (await doc.get()).data() as ArchiveRecord | undefined;
  let resultPath = existing?.storage.resultPath ?? null;
  let identityResultPath = existing?.storage.identityResultPath ?? null;

  if (result) {
    resultPath = await uploadBytes(
      `sessions/${session.id}/result`,
      result.bytes,
      result.mime,
    );

    if (existing?.identityKey && resultPath) {
      identityResultPath = await uploadBytes(
        `identities/${existing.identityKey}/${session.id}/result`,
        result.bytes,
        result.mime,
      );
    }
  }

  await doc.set(
    {
      status: session.status,
      expiresAt: session.expiresAt,
      updatedAt: new Date().toISOString(),
      generationStartedAt: session.generationStartedAt ?? null,
      generationAttempts: session.generationAttempts ?? 0,
      error: session.error ?? null,
      resultMime: session.resultMime ?? result?.mime ?? null,
      resultAt: session.resultAt ?? null,
      generationOptions: session.generationOptions ?? null,
      storage: {
        inputPath: existing?.storage.inputPath ?? null,
        resultPath,
        identityInputPath: existing?.storage.identityInputPath ?? null,
        identityResultPath,
      },
    },
    { merge: true },
  );
  await mirrorPortraitToRoster(session, false);
}

export async function claimSessionIdentity(
  session: ImageSession,
  identity: GuestIdentity,
  images: {
    input: { bytes: Buffer; mime: string };
    result: { bytes: Buffer; mime: string } | null;
  },
) {
  if (!isFirebaseConfigured()) {
    throw new Error("尚未設定 Firebase，無法保存身分資料。");
  }

  const key = identityStorageKey(identity);
  const claimedAt = new Date().toISOString();
  const identityRef = identityDoc(key);
  if (!identityRef) {
    throw new Error("尚未設定 Firebase，無法保存身分資料。");
  }

  const identityInputPath = await uploadBytes(
    `identities/${key}/${session.id}/input`,
    images.input.bytes,
    images.input.mime,
  );

  let identityResultPath: string | null = null;
  if (images.result) {
    identityResultPath = await uploadBytes(
      `identities/${key}/${session.id}/result`,
      images.result.bytes,
      images.result.mime,
    );
  }

  await sessionDoc(session.id)?.set(
    {
      identityKind: identity.kind,
      identityValue: identity.value,
      identityKey: key,
      claimedAt,
      updatedAt: claimedAt,
      status: session.status,
      error: session.error ?? null,
      storage: {
        identityInputPath,
        identityResultPath,
      },
    },
    { merge: true },
  );

  const previous = await identityRef.get();
  const previousIds = (previous.data()?.sessionIds as string[] | undefined) ?? [];
  await identityRef.set(
    {
      kind: identity.kind,
      value: identity.value,
      updatedAt: claimedAt,
      sessionIds: Array.from(new Set([...previousIds, session.id])),
    },
    { merge: true },
  );

  return { identityKey: key, claimedAt };
}

export class FinalResultUnavailableError extends Error {
  constructor(message = "尚未連線 Firebase，無法保存調整後的作品。") {
    super(message);
    this.name = "FinalResultUnavailableError";
  }
}

/** The upload itself is the problem; the admin should pick another file. */
export class FinalResultInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalResultInputError";
  }
}

const REVISION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SIGNED_UPLOAD_TTL_MS = 15 * 60_000;
const SIGNED_DOWNLOAD_TTL_MS = 5 * 60_000;

function newRevisionId() {
  return `${Date.now().toString(36)}-${randomBytes(6).toString("base64url")}`;
}

function finalObjectPath(sessionId: string, revisionId: string) {
  return `sessions/${sessionId}/final/${revisionId}`;
}

/** Where a browser PUTs an original before the server has checked it. */
function stagingObjectPath(sessionId: string, uploadId: string) {
  return `sessions/${sessionId}/uploads/${uploadId}`;
}

export function previewObjectPath(sessionId: string, key: string) {
  return `sessions/${sessionId}/preview/${key}.jpg`;
}

function requireFinalTarget(sessionId: string) {
  const doc = sessionDoc(sessionId);
  const bucket = getBucket();
  if (!isFirebaseConfigured() || !doc || !bucket) {
    throw new FinalResultUnavailableError();
  }
  return { doc, bucket };
}

/** Best effort: the preview is a cache, and a guest request rebuilds it. */
export async function storePreview(sessionId: string, key: string, bytes: Buffer) {
  return uploadBytes(previewObjectPath(sessionId, key), bytes, PREVIEW_MIME);
}

/**
 * Checks the original (magic number, then a full decode while building the
 * preview), writes it to a fresh `final/` object from these exact bytes, then
 * points the session at it. Nothing reaches `final/` unchecked, and the
 * pointer moves last, so guests never see a revision without its preview.
 */
async function acceptFinalResult(
  sessionId: string,
  image: { bytes: Buffer; mime: AdjustedMime },
): Promise<FinalResult> {
  const { doc } = requireFinalTarget(sessionId);
  if (!hasExpectedSignature(image.bytes, image.mime)) {
    throw new FinalResultInputError("上傳的檔案不是有效的圖片。");
  }
  const preview = await compressPreview(image.bytes);

  const revisionId = newRevisionId();
  const path = await uploadBytes(
    finalObjectPath(sessionId, revisionId),
    image.bytes,
    image.mime,
  );
  if (!path) {
    throw new FinalResultUnavailableError("無法保存調整後的作品，請稍後再試。");
  }
  const previewPath = await storePreview(sessionId, `final-${revisionId}`, preview);

  const uploadedAt = new Date().toISOString();
  const finalResult: FinalResult = {
    path,
    mime: image.mime,
    revisionId,
    uploadedAt,
    size: image.bytes.length,
    previewPath,
  };
  // Only the pointer changes; earlier uploads stay in Storage for the record.
  await doc.set({ finalResult, updatedAt: uploadedAt }, { merge: true });
  return finalResult;
}

/**
 * Small files (and local emulators, which cannot sign URLs) come through the
 * function; the route has already checked type, size and magic number.
 */
export async function storeFinalResult(
  sessionId: string,
  image: { bytes: Buffer; mime: string },
): Promise<FinalResult> {
  requireFinalTarget(sessionId);
  if (!isAdjustedMime(image.mime)) {
    throw new FinalResultInputError("請使用 JPEG、PNG 或 WebP 格式的圖片。");
  }
  return acceptFinalResult(sessionId, { bytes: image.bytes, mime: image.mime });
}

/**
 * Remedy for a render that failed: the admin's accepted upload also becomes
 * the session's result, so the session counts as complete and check-in hands
 * the portrait over without another OpenAI call. A no-op once complete, so a
 * retried upload is safe. The roster mirror here is best effort, so the
 * caller records the completion on the roster itself.
 */
export async function completeSessionWithFinal(sessionId: string, finalResult: FinalResult) {
  if ((await getSession(sessionId)).status === "complete") return;
  const image = await readArchiveImage(finalResult.path);
  if (!image) {
    throw new FinalResultUnavailableError("無法保存調整後的作品，請稍後再試。");
  }
  const result = { bytes: image.bytes, mime: finalResult.mime };
  const finished = await writeResultImage(sessionId, result.bytes, result.mime);
  await archiveSessionStatus(finished, result);
}

/**
 * For a guest who never sent a photo: the admin's accepted upload becomes a
 * new, already complete session linked to them, so check-in hands it over
 * like any other portrait. The caller records it on the roster.
 */
export async function createSessionFromFinal(
  sessionId: string,
  rosterEntryId: string,
  finalResult: FinalResult,
) {
  const image = await readArchiveImage(finalResult.path);
  if (!image) {
    throw new FinalResultUnavailableError("無法保存調整後的作品，請稍後再試。");
  }
  const result = { bytes: image.bytes, mime: finalResult.mime };
  const session = await createCompleteSession(sessionId, result, { rosterEntryId });
  await archiveSessionCreated(session, result);
  await archiveSessionStatus(session, result);
}

/**
 * The session id inside a staging path signed for a guest with no portrait
 * yet (see `createFinalUploadTarget`). Refuses any id that already has a
 * record, so a path can never attach an upload to someone else's portrait.
 */
export async function unclaimedSessionFromUpload(objectPath: unknown): Promise<string> {
  const sessionId =
    typeof objectPath === "string" ? /^sessions\/([^/]+)\/uploads\//.exec(objectPath)?.[1] : null;
  if (!isSessionId(sessionId) || (await readArchiveRecord(sessionId))) {
    throw new FinalResultInputError("上傳的檔案位置不正確，請重新上傳。");
  }
  return sessionId;
}

export type FinalUploadTarget = {
  uploadUrl: string;
  objectPath: string;
  /** Send exactly these with the PUT: both are part of the signature. */
  headers: Record<string, string>;
  expiresAt: string;
};

/**
 * A signed PUT straight to Storage, so the original never passes through a
 * Vercel function. It lands in a staging folder that guests are never served
 * from, capped at MAX_ADJUSTED_BYTES by a signed length-range header. Null
 * when URLs cannot be signed (local emulators); the caller then falls back to
 * `storeFinalResult`. The bucket needs the CORS rule from the README.
 */
export async function createFinalUploadTarget(
  sessionId: string,
  contentType: AdjustedMime,
): Promise<FinalUploadTarget | null> {
  const { bucket } = requireFinalTarget(sessionId);
  if (isFirebaseEmulator()) return null;

  const objectPath = stagingObjectPath(sessionId, newRevisionId());
  const expires = Date.now() + SIGNED_UPLOAD_TTL_MS;
  const lengthRange = `0,${MAX_ADJUSTED_BYTES}`;
  try {
    const [uploadUrl] = await bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "write",
      expires,
      contentType,
      extensionHeaders: { "x-goog-content-length-range": lengthRange },
    });
    return {
      uploadUrl,
      objectPath,
      headers: {
        "Content-Type": contentType,
        "x-goog-content-length-range": lengthRange,
      },
      expiresAt: new Date(expires).toISOString(),
    };
  } catch (error) {
    console.error(`Could not sign an upload URL for ${objectPath}:`, error);
    return null;
  }
}

/**
 * Accepts a file the browser PUT through `createFinalUploadTarget`. Only a
 * path in this session's staging folder is accepted. The bytes are checked in
 * memory and those same bytes become the `final/` object, so a later PUT to
 * the still-valid URL can never change what guests get. The staging copy is
 * deleted once accepted or proven bad; a transient failure keeps it for a retry.
 */
export async function finalizeUploadedFinalResult(
  sessionId: string,
  objectPath: unknown,
): Promise<FinalResult> {
  const { bucket } = requireFinalTarget(sessionId);
  const prefix = `sessions/${sessionId}/uploads/`;
  const uploadId =
    typeof objectPath === "string" && objectPath.startsWith(prefix)
      ? objectPath.slice(prefix.length)
      : "";
  if (!REVISION_PATTERN.test(uploadId)) {
    throw new FinalResultInputError("上傳的檔案位置不正確，請重新上傳。");
  }
  const file = bucket.file(stagingObjectPath(sessionId, uploadId));
  const discard = () => file.delete({ ignoreNotFound: true }).catch(() => undefined);

  let metadata;
  let bytes: Buffer;
  try {
    [metadata] = await file.getMetadata();
  } catch (error) {
    if (storageErrorCode(error) === 404) {
      throw new FinalResultInputError("找不到剛上傳的檔案，請重新上傳。");
    }
    throw new FinalResultUnavailableError("暫時無法讀取剛上傳的檔案，請再試一次。");
  }

  const size = Number(metadata.size);
  const mime = metadata.contentType;
  if (!isAdjustedMime(mime)) {
    await discard();
    throw new FinalResultInputError("請使用 JPEG、PNG 或 WebP 格式的圖片。");
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_ADJUSTED_BYTES) {
    await discard();
    throw new FinalResultInputError(`圖片必須小於 ${MAX_ADJUSTED_BYTES / 1024 / 1024} MB。`);
  }

  try {
    [bytes] = await file.download();
  } catch {
    throw new FinalResultUnavailableError("暫時無法讀取剛上傳的檔案，請再試一次。");
  }

  try {
    const finalResult = await acceptFinalResult(sessionId, { bytes: Buffer.from(bytes), mime });
    await discard();
    return finalResult;
  } catch (error) {
    if (error instanceof FinalResultInputError || error instanceof PreviewError) {
      await discard();
    }
    throw error;
  }
}

function storageErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

/**
 * A short-lived download link straight from Storage, for originals too big
 * to stream through a function. Null when URLs cannot be signed.
 */
export async function signedDownloadUrl(
  objectPath: string,
  options: { filename: string; mime: string },
): Promise<string | null> {
  const bucket = getBucket();
  if (!bucket || isFirebaseEmulator()) return null;
  try {
    const [url] = await bucket.file(objectPath).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + SIGNED_DOWNLOAD_TTL_MS,
      responseDisposition: `attachment; filename="${options.filename}"`,
      responseType: options.mime,
    });
    return url;
  } catch (error) {
    console.error(`Could not sign a download URL for ${objectPath}:`, error);
    return null;
  }
}

/** Goes back to the generated portrait. Uploaded files are kept. */
export async function clearFinalResult(sessionId: string) {
  const { doc } = requireFinalTarget(sessionId);
  await doc.set(
    { finalResult: null, updatedAt: new Date().toISOString() },
    { merge: true },
  );
}

export async function markAvatarRequest(
  sessionId: string,
  outcome: { ok: true } | { ok: false; error: string },
) {
  if (!isFirebaseConfigured()) return;

  await sessionDoc(sessionId)?.set(
    {
      avatarRequestedAt: new Date().toISOString(),
      avatarRequestStatus: outcome.ok ? "success" : "failed",
      avatarRequestError: outcome.ok ? null : outcome.error,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
}

export async function readArchiveRecord(sessionId: string) {
  const snap = await sessionDoc(sessionId)?.get();
  return (snap?.data() as ArchiveRecord | undefined) ?? null;
}

/** `missingOk`: a cache lookup, where an absent object is expected and not logged. */
export async function readArchiveImage(
  objectPath: string,
  { missingOk = false }: { missingOk?: boolean } = {},
): Promise<{
  bytes: Buffer;
  mime: string;
} | null> {
  const bucket = getBucket();
  if (!bucket || !objectPath) return null;

  try {
    const file = bucket.file(objectPath);
    const [bytes] = await file.download();
    const [metadata] = await file.getMetadata();
    const mime =
      typeof metadata.contentType === "string" && metadata.contentType
        ? metadata.contentType
        : "application/octet-stream";
    return { bytes: Buffer.from(bytes), mime };
  } catch (error) {
    if (!(missingOk && storageErrorCode(error) === 404)) {
      console.error(`Firebase Storage download failed for ${objectPath}:`, error);
    }
    return null;
  }
}

export type ListArchiveResult = {
  sessions: ArchiveRecord[];
  error: string | null;
};

/**
 * Newest first. `before` is the `createdAt` of the last row already shown, so
 * the admin list can page past the first batch without re-reading it.
 */
export async function listArchiveSessions({
  limit = 50,
  before,
}: {
  limit?: number;
  before?: string | null;
} = {}): Promise<ListArchiveResult> {
  if (!isFirebaseConfigured()) {
    return { sessions: [], error: "Firebase is not configured." };
  }

  const db = getDb();
  if (!db) {
    return { sessions: [], error: "Firebase is not configured." };
  }

  const capped = Math.min(Math.max(limit, 1), 200);

  try {
    let query = db.collection("sessions").orderBy("createdAt", "desc");
    if (before) query = query.startAfter(before);
    const snap = await query.limit(capped).get();

    const sessions = snap.docs.map((doc) => {
      const data = doc.data() as ArchiveRecord;
      return {
        ...data,
        sessionId: data.sessionId || doc.id,
      };
    });

    return { sessions, error: null };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list archive sessions.";
    console.error("listArchiveSessions failed:", error);
    return { sessions: [], error: message };
  }
}

export type ArchiveCounts = {
  total: number;
  complete: number;
  failed: number;
};

/**
 * True totals for the admin metrics. Count aggregations bill one read per
 * 1,000 matched docs, so the 5-second dashboard poll stays cheap.
 */
export async function countArchiveSessions(): Promise<ArchiveCounts | null> {
  if (!isFirebaseConfigured()) return null;
  const db = getDb();
  if (!db) return null;

  try {
    const sessions = db.collection("sessions");
    const [total, complete, failed] = await Promise.all([
      sessions.count().get(),
      sessions.where("status", "==", "complete").count().get(),
      sessions.where("status", "==", "failed").count().get(),
    ]);
    return {
      total: total.data().count,
      complete: complete.data().count,
      failed: failed.data().count,
    };
  } catch (error) {
    console.error("countArchiveSessions failed:", error);
    return null;
  }
}

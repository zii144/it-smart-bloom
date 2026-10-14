import { FieldValue } from "firebase-admin/firestore";
import { ConfigError } from "@/lib/api-errors";
import type { GuestIdentity } from "@/lib/guest-identity";
import { identityStorageKey } from "@/lib/guest-identity";
import { getBucket, getDb, isFirebaseConfigured } from "@/lib/firebase-admin";
import type { ImageSession, SessionStatus } from "@/lib/sessions";

export type ArchiveRecord = {
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string | null;
  updatedAt: string;
  generationStartedAt: string | null;
  error: string | null;
  inputMime: string;
  resultMime: string | null;
  source: ImageSession["source"] | null;
  generationOptions: ImageSession["generationOptions"] | null;
  identityKind: GuestIdentity["kind"] | null;
  identityValue: string | null;
  identityKey: string | null;
  claimedAt: string | null;
  avatarRequestedAt: string | null;
  avatarRequestStatus: "idle" | "success" | "failed" | null;
  avatarRequestError: string | null;
  storage: {
    inputPath: string | null;
    resultPath: string | null;
  };
};

/** What `archiveSessionCreated` actually managed to persist. */
export type ArchiveOutcome = {
  /** The session document reached Firestore. */
  archived: boolean;
  /** The source photo reached Cloud Storage. */
  inputStored: boolean;
  /** The guest's identity was indexed; false when there was none to index. */
  identityIndexed: boolean;
};

function sessionDoc(sessionId: string) {
  const db = getDb();
  if (!db) return null;
  return db.collection("sessions").doc(sessionId);
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

/**
 * One document per identity, listing the sessions that identity owns.
 *
 * The portrait bytes are deliberately NOT duplicated under `identities/` — a
 * session id already resolves to `sessions/{id}/input` — so there is exactly
 * one copy of each guest photo to secure, to serve, and to purge.
 *
 * `arrayUnion` appends server-side. A read-then-write would silently drop one
 * of two captures racing for the same number, which is the ordinary case when a
 * guest retakes their photo.
 */
async function indexIdentity(
  identityKey: string,
  identity: GuestIdentity,
  sessionId: string,
  at: string,
) {
  const ref = identityDoc(identityKey);
  if (!ref) {
    throw new ConfigError(
      "尚未設定 Firebase，無法保存身分資料。",
      "ARCHIVE_UNAVAILABLE",
    );
  }

  await ref.set(
    {
      kind: identity.kind,
      value: identity.value,
      updatedAt: at,
      sessionIds: FieldValue.arrayUnion(sessionId),
    },
    { merge: true },
  );
}

export async function archiveSessionCreated(
  session: ImageSession,
  input: {
    bytes: Buffer;
    mime: string;
  },
): Promise<ArchiveOutcome> {
  if (!isFirebaseConfigured()) {
    return { archived: false, inputStored: false, identityIndexed: false };
  }

  const inputPath = await uploadBytes(
    `sessions/${session.id}/input`,
    input.bytes,
    input.mime,
  );

  const now = new Date().toISOString();
  const identity = session.identity;

  // Indexed before the session record is written, so the record never names an
  // `identityKey` that resolves to nothing. A failure here keeps the identity on
  // the session — the guest still needs it — but leaves the key null, and is
  // reported back so the caller can say what actually happened.
  let identityKey: string | null = null;
  if (identity) {
    try {
      const key = identityStorageKey(identity);
      await indexIdentity(key, identity, session.id, now);
      identityKey = key;
    } catch (error) {
      console.error(
        `Failed to index identity for session ${session.id}:`,
        error,
      );
    }
  }

  const record: ArchiveRecord = {
    sessionId: session.id,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    updatedAt: now,
    generationStartedAt: session.generationStartedAt ?? null,
    error: session.error ?? null,
    inputMime: session.inputMime,
    resultMime: session.resultMime ?? null,
    source: session.source ?? null,
    generationOptions: session.generationOptions ?? null,
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
    },
  };

  await sessionDoc(session.id)?.set(record, { merge: true });

  return {
    archived: true,
    inputStored: Boolean(inputPath),
    identityIndexed: Boolean(identityKey),
  };
}

export async function archiveSessionStatus(
  session: ImageSession,
  result?: { bytes: Buffer; mime: string } | null,
) {
  if (!isFirebaseConfigured()) return;

  const doc = sessionDoc(session.id);
  if (!doc) return;

  const update: Record<string, unknown> = {
    status: session.status,
    expiresAt: session.expiresAt,
    updatedAt: new Date().toISOString(),
    generationStartedAt: session.generationStartedAt ?? null,
    error: session.error ?? null,
    resultMime: session.resultMime ?? result?.mime ?? null,
    generationOptions: session.generationOptions ?? null,
  };

  if (result) {
    const resultPath = await uploadBytes(
      `sessions/${session.id}/result`,
      result.bytes,
      result.mime,
    );

    // Firestore merges nested maps key by key, so writing only `resultPath`
    // leaves `storage.inputPath` untouched — no read-back needed. A failed
    // upload writes nothing rather than clobbering a path that already worked.
    if (resultPath) {
      update.storage = { resultPath };
    } else {
      console.error(
        `Failed to archive the result image for session ${session.id}.`,
      );
    }
  }

  await doc.set(update, { merge: true });
}

export async function readArchiveRecord(sessionId: string) {
  const snap = await sessionDoc(sessionId)?.get();
  return (snap?.data() as ArchiveRecord | undefined) ?? null;
}

export async function readArchiveImage(objectPath: string): Promise<{
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
    console.error(`Firebase Storage download failed for ${objectPath}:`, error);
    return null;
  }
}

export type ListArchiveResult = {
  sessions: ArchiveRecord[];
  error: string | null;
};

export async function listArchiveSessions({
  limit = 50,
}: {
  limit?: number;
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
    const snap = await db
      .collection("sessions")
      .orderBy("createdAt", "desc")
      .limit(capped)
      .get();

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

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
  /** "mobile" for 姓名 + 手機 records; legacy records may hold "lineId". */
  identityKind: "mobile" | "lineId" | null;
  /** The mobile (or, on legacy records, the LINE ID). */
  identityValue: string | null;
  /** The guest's 姓名; null on legacy records. */
  identityName: string | null;
  identityKey: string | null;
  claimedAt: string | null;
  avatarRequestedAt: string | null;
  avatarRequestStatus: "idle" | "success" | "failed" | null;
  avatarRequestError: string | null;
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

function identityDoc(identityKey: string) {
  const db = getDb();
  if (!db) return null;
  return db.collection("identities").doc(identityKey);
}

/** Storage paths under identities/ embed the guest's mobile; keep it out of logs. */
function redactPath(objectPath: string) {
  return objectPath.replace(/mobile_\d+/g, "mobile_***");
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
    console.error(
      `Firebase Storage upload failed for ${redactPath(objectPath)}:`,
      error,
    );
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
  const identityKey = identity ? identityStorageKey(identity) : null;
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
    error: session.error ?? null,
    inputMime: session.inputMime,
    resultMime: session.resultMime ?? null,
    source: session.source ?? null,
    generationOptions: session.generationOptions ?? null,
    identityKind: identity ? "mobile" : null,
    identityValue: identity?.mobile ?? null,
    identityName: identity?.name ?? null,
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

  if (identity && identityKey) {
    const ref = identityDoc(identityKey);
    const previous = await ref?.get();
    const previousIds =
      (previous?.data()?.sessionIds as string[] | undefined) ?? [];
    await ref?.set(
      {
        kind: "mobile",
        value: identity.mobile,
        name: identity.name,
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
      error: session.error ?? null,
      resultMime: session.resultMime ?? result?.mime ?? null,
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
}

/**
 * Admin label for an archived identity: "姓名｜手機" for current records, or
 * the legacy "kind:value" form (LINE ID / mobile only), which the dashboard
 * localizes.
 */
export function archiveIdentityLabel(record: {
  identityKind?: string | null;
  identityValue?: string | null;
  identityName?: string | null;
}) {
  if (!record.identityKind || !record.identityValue) return null;
  if (record.identityName) {
    return `${record.identityName}｜${record.identityValue}`;
  }
  return `${record.identityKind}:${record.identityValue}`;
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
    console.error(
      `Firebase Storage download failed for ${redactPath(objectPath)}:`,
      error,
    );
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

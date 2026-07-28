import type { GuestIdentity } from "@/lib/guest-identity";
import { identityStorageKey } from "@/lib/guest-identity";
import { getBucket, getDb, isFirebaseConfigured } from "@/lib/firebase-admin";
import type { ImageSession, SessionStatus } from "@/lib/sessions";

export type ArchiveRecord = {
  sessionId: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  generationStartedAt: string | null;
  error: string | null;
  inputMime: string;
  resultMime: string | null;
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

  const now = new Date().toISOString();
  const record: ArchiveRecord = {
    sessionId: session.id,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: now,
    generationStartedAt: session.generationStartedAt ?? null,
    error: session.error ?? null,
    inputMime: session.inputMime,
    resultMime: session.resultMime ?? null,
    identityKind: null,
    identityValue: null,
    identityKey: null,
    claimedAt: null,
    avatarRequestedAt: null,
    avatarRequestStatus: "idle",
    avatarRequestError: null,
    storage: {
      inputPath,
      resultPath: null,
      identityInputPath: null,
      identityResultPath: null,
    },
  };

  await sessionDoc(session.id)?.set(record, { merge: true });
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
      updatedAt: new Date().toISOString(),
      generationStartedAt: session.generationStartedAt ?? null,
      error: session.error ?? null,
      resultMime: session.resultMime ?? result?.mime ?? null,
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

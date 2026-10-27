import { randomBytes } from "node:crypto";
import type {
  DocumentData,
  Firestore,
  WriteBatch,
} from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import {
  hasSubmittedPhoto,
  MAX_ROSTER_ROWS,
  normalizeRosterMobile,
  planRosterImport,
  rosterEntryFromRow,
  rosterMatchKey,
  rosterNameKey,
  type CheckInSource,
  type ParsedRoster,
  type PortraitStatus,
  type RosterEntry,
  type RosterEntryData,
  type RosterImportPlan,
  type RosterInput,
} from "@/lib/roster";

const ROSTER_COLLECTION = "roster";
const META_COLLECTION = "rosterMeta";
const LAST_IMPORT_DOC = "lastImport";
const CHECK_IN_DOC = "checkIn";
/** Firestore caps a batch at 500 writes; stay well under it. */
const WRITE_BATCH_SIZE = 400;

export class RosterUnavailableError extends Error {
  constructor() {
    super("名單服務暫時無法使用，請洽現場工作人員。");
    this.name = "RosterUnavailableError";
  }
}

export class RosterConflictError extends Error {
  constructor() {
    super("已有相同姓名與手機的資料。");
    this.name = "RosterConflictError";
  }
}

export class PhotoAlreadySubmittedError extends Error {
  constructor() {
    super("您已經上傳過照片，每位來賓限一次。如需重新上傳，請洽現場工作人員。");
    this.name = "PhotoAlreadySubmittedError";
  }
}

export class RosterNotFoundError extends Error {
  constructor() {
    super("找不到這筆名單資料。");
    this.name = "RosterNotFoundError";
  }
}

export type RosterImportMeta = {
  importedAt: string;
  sheet: string;
  created: number;
  updated: number;
  unchanged: number;
  issues: number;
};

function requireDb(): Firestore {
  const db = getDb();
  if (!db) throw new RosterUnavailableError();
  return db;
}

function rosterCollection(db: Firestore) {
  return db.collection(ROSTER_COLLECTION);
}

function toEntry(id: string, data: DocumentData): RosterEntry {
  return { id, ...(data as RosterEntryData) };
}

function compareEntries(left: RosterEntry, right: RosterEntry) {
  // Seats like A2 / A10 sort naturally; people without a seat go last.
  if (left.seat && right.seat) {
    const bySeat = left.seat.localeCompare(right.seat, "zh-TW", { numeric: true });
    if (bySeat) return bySeat;
  } else if (left.seat || right.seat) {
    return left.seat ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "zh-TW");
}

export async function listRosterEntries(): Promise<RosterEntry[]> {
  const db = requireDb();
  const snapshot = await rosterCollection(db).limit(MAX_ROSTER_ROWS * 2).get();
  return snapshot.docs
    .map((doc) => toEntry(doc.id, doc.data()))
    .sort(compareEntries);
}

export async function readLastImport(): Promise<RosterImportMeta | null> {
  const db = requireDb();
  const doc = await db.collection(META_COLLECTION).doc(LAST_IMPORT_DOC).get();
  return doc.exists ? (doc.data() as RosterImportMeta) : null;
}

function entryData(
  input: RosterInput,
  source: RosterEntryData["source"],
  now: string,
  createdAt = now,
): RosterEntryData {
  return {
    ...input,
    nameKey: rosterNameKey(input.name),
    matchKey: rosterMatchKey(input.name, input.mobile),
    source,
    createdAt,
    updatedAt: now,
  };
}

/** Name + mobile identify a person, so two entries may never share them. */
export async function createRosterEntry(input: RosterInput) {
  const db = requireDb();
  const now = new Date().toISOString();
  const data = entryData(input, "admin", now);
  const ref = rosterCollection(db).doc();

  await db.runTransaction(async (transaction) => {
    if (data.matchKey) {
      const clash = await transaction.get(
        rosterCollection(db).where("matchKey", "==", data.matchKey).limit(1),
      );
      if (!clash.empty) throw new RosterConflictError();
    }
    transaction.set(ref, data);
  });

  return toEntry(ref.id, data);
}

export async function updateRosterEntry(id: string, input: RosterInput) {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);
  const now = new Date().toISOString();

  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) throw new RosterNotFoundError();
    const previous = current.data() as RosterEntryData;
    const data = entryData(input, previous.source, now, previous.createdAt);

    if (data.matchKey && data.matchKey !== previous.matchKey) {
      const clash = await transaction.get(
        rosterCollection(db).where("matchKey", "==", data.matchKey).limit(2),
      );
      if (clash.docs.some((doc) => doc.id !== id)) {
        throw new RosterConflictError();
      }
    }

    // Keep event-day state (check-in, portrait) that the edit form never sends.
    const merged = { ...previous, ...data };
    transaction.set(ref, merged);
    return toEntry(id, merged);
  });
}

export async function deleteRosterEntry(id: string) {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);
  const current = await ref.get();
  if (!current.exists) throw new RosterNotFoundError();
  await ref.delete();
}

/** Plans against the live collection without writing anything. */
export async function previewRosterImport(
  parsed: ParsedRoster,
): Promise<RosterImportPlan> {
  return planRosterImport(parsed, await listRosterEntries());
}

/**
 * Re-plans against the live collection (never trusts a preview the browser
 * sends back), then writes creates and updates in batches.
 */
export async function applyRosterImport(
  parsed: ParsedRoster,
): Promise<RosterImportPlan> {
  const db = requireDb();
  const plan = planRosterImport(parsed, await listRosterEntries());
  const now = new Date().toISOString();

  const writes: ((batch: WriteBatch) => void)[] = [
    ...plan.creates.map((row) => (batch: WriteBatch) => {
      batch.set(rosterCollection(db).doc(), rosterEntryFromRow(row, now));
    }),
    ...plan.updates.map(
      (update) => (batch: WriteBatch) => {
        batch.update(rosterCollection(db).doc(update.id), {
          ...update.patch,
          updatedAt: now,
        });
      },
    ),
  ];

  for (let start = 0; start < writes.length; start += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const write of writes.slice(start, start + WRITE_BATCH_SIZE)) {
      write(batch);
    }
    await batch.commit();
  }

  const meta: RosterImportMeta = {
    importedAt: now,
    sheet: plan.sheet,
    created: plan.creates.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged,
    issues: plan.issues.length,
  };
  await db.collection(META_COLLECTION).doc(LAST_IMPORT_DOC).set(meta);

  return plan;
}

/**
 * Guest check: 姓名 and 手機 must both match one roster entry. Returns only
 * the entry id — callers never need (or get) the rest of the record.
 */
export async function findRosterMatch(
  name: string,
  mobile: string,
): Promise<{ id: string } | null> {
  const key = rosterMatchKey(name, normalizeRosterMobile(mobile));
  if (!key) return null;

  const db = requireDb();
  const snapshot = await rosterCollection(db)
    .where("matchKey", "==", key)
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  return doc ? { id: doc.id } : null;
}

// —— Event day: check-in ——

export type CheckInSettings = { open: boolean; updatedAt: string | null };

/** How long a check-in's portrait link keeps working. */
export const PORTRAIT_ACCESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CheckInResult = {
  name: string;
  seat: string;
  checkedInAt: string;
  /** True when the guest had already checked in; the original time is kept. */
  alreadyCheckedIn: boolean;
  portrait: {
    status: PortraitStatus | null;
    /** Only once the portrait is finished: the token for /api/check-in/portrait. */
    accessToken: string | null;
  };
};

export async function readCheckInSettings(): Promise<CheckInSettings> {
  const db = requireDb();
  const doc = await db.collection(META_COLLECTION).doc(CHECK_IN_DOC).get();
  const data = doc.data() as Partial<CheckInSettings> | undefined;
  // Closed until an admin opens it.
  return { open: data?.open === true, updatedAt: data?.updatedAt ?? null };
}

export async function setCheckInOpen(open: boolean): Promise<CheckInSettings> {
  const db = requireDb();
  const settings = { open, updatedAt: new Date().toISOString() };
  await db.collection(META_COLLECTION).doc(CHECK_IN_DOC).set(settings);
  return settings;
}

/**
 * Marks a guest arrived. Idempotent: a second check-in keeps the first time,
 * so a guest re-scanning the poster never moves their arrival later.
 *
 * Every successful check-in (first or repeat) also hands over the finished
 * portrait, if there is one, via a fresh random access token: proving 姓名 +
 * 手機 at check-in is what earns the portrait.
 */
export async function checkInRosterEntry(
  id: string,
  source: CheckInSource,
): Promise<CheckInResult> {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);

  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) throw new RosterNotFoundError();
    const entry = current.data() as RosterEntryData;
    const now = new Date();
    const alreadyCheckedIn = Boolean(entry.checkedInAt);
    const checkedInAt = entry.checkedInAt ?? now.toISOString();

    const portraitReady = entry.portraitStatus === "complete" && entry.portraitSessionId;
    const accessToken = portraitReady ? randomBytes(32).toString("base64url") : null;

    const changes: Partial<RosterEntryData> = {};
    if (!alreadyCheckedIn) {
      changes.checkedInAt = checkedInAt;
      changes.checkInSource = source;
    }
    if (accessToken) {
      changes.portraitAccessToken = accessToken;
      changes.portraitAccessExpiresAt = new Date(
        now.getTime() + PORTRAIT_ACCESS_TTL_MS,
      ).toISOString();
    }
    if (Object.keys(changes).length) transaction.update(ref, changes);

    return {
      name: entry.name,
      seat: entry.seat ?? "",
      checkedInAt,
      alreadyCheckedIn,
      portrait: { status: entry.portraitStatus ?? null, accessToken },
    };
  });
}

/**
 * Resolves a check-in portrait token to the guest's portrait session, or
 * null when it is unknown, expired, or the portrait has since changed.
 */
export async function findPortraitByAccessToken(
  token: string,
): Promise<{ sessionId: string; name: string } | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const db = requireDb();
  const snapshot = await rosterCollection(db)
    .where("portraitAccessToken", "==", token)
    .limit(1)
    .get();
  const entry = snapshot.docs[0]?.data() as RosterEntryData | undefined;
  if (!entry?.portraitSessionId || entry.portraitStatus !== "complete") return null;
  const expiresAt = Date.parse(entry.portraitAccessExpiresAt ?? "");
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return { sessionId: entry.portraitSessionId, name: entry.name };
}

/** Admin undo for a mistaken check-in. */
export async function undoRosterCheckIn(id: string) {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) throw new RosterNotFoundError();
    // Undoing the arrival also takes back the portrait link it handed out.
    transaction.update(ref, {
      checkedInAt: null,
      checkInSource: null,
      portraitAccessToken: null,
      portraitAccessExpiresAt: null,
    });
  });
}

/** Name and seat for the guest-facing success card; nothing else. */
export async function readRosterGuest(
  id: string,
): Promise<{ name: string; seat: string } | null> {
  const db = requireDb();
  const doc = await rosterCollection(db).doc(id).get();
  if (!doc.exists) return null;
  const entry = doc.data() as RosterEntryData;
  return { name: entry.name, seat: entry.seat ?? "" };
}

// —— Event day: portrait status ——

/**
 * Mirrors a booth session's status onto its guest's roster entry, so the
 * admin check-in view reads one collection instead of every session.
 * A newer session takes over; a late update from an older one is ignored.
 * A deleted roster entry is left deleted.
 *
 * Also keeps the one-photo rule honest: only a portrait that did not fail
 * counts, so a failed render gives the guest their submission back, and a
 * finished one (e.g. a retry that succeeded) takes it again.
 */
export async function recordRosterPortrait(
  id: string,
  sessionId: string,
  status: PortraitStatus,
  options: { isNewSession: boolean },
) {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);

  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) return;
    const entry = current.data() as RosterEntryData;
    if (
      !options.isNewSession &&
      entry.portraitSessionId &&
      entry.portraitSessionId !== sessionId
    ) {
      return;
    }
    const now = new Date().toISOString();
    const submission =
      status === "failed"
        ? { photoSubmittedAt: null }
        : status === "complete" && !entry.photoSubmittedAt
          ? { photoSubmittedAt: now }
          : {};
    transaction.update(ref, {
      portraitSessionId: sessionId,
      portraitStatus: status,
      portraitUpdatedAt: now,
      ...submission,
    });
  });
}

// —— One photo per guest ——

export async function isPhotoSubmitted(id: string) {
  const db = requireDb();
  const doc = await rosterCollection(db).doc(id).get();
  if (!doc.exists) throw new RosterNotFoundError();
  return hasSubmittedPhoto(doc.data() as RosterEntryData);
}

/**
 * Claims the guest's one submission before their photo is stored. Atomic, so
 * two submissions racing from two phones cannot both get through. Returns the
 * claim time, which `releasePhotoSubmission` needs if storing then fails.
 */
export async function reservePhotoSubmission(id: string): Promise<string> {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) throw new RosterNotFoundError();
    if (hasSubmittedPhoto(current.data() as RosterEntryData)) {
      throw new PhotoAlreadySubmittedError();
    }
    const reservedAt = new Date().toISOString();
    transaction.update(ref, { photoSubmittedAt: reservedAt });
    return reservedAt;
  });
}

/** Gives the submission back when the photo could not be stored after all. */
export async function releasePhotoSubmission(id: string, reservedAt: string) {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    const entry = current.data() as RosterEntryData | undefined;
    // Only undo our own claim, never a later one.
    if (entry?.photoSubmittedAt === reservedAt) {
      transaction.update(ref, { photoSubmittedAt: null });
    }
  });
}

/** Admin: let this guest submit one more photo. Their current portrait stays until replaced. */
export async function allowPhotoResubmission(id: string) {
  const db = requireDb();
  const ref = rosterCollection(db).doc(id);
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref);
    if (!current.exists) throw new RosterNotFoundError();
    transaction.update(ref, { photoSubmittedAt: null });
  });
}

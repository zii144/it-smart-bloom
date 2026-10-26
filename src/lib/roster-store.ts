import type {
  DocumentData,
  Firestore,
  WriteBatch,
} from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import {
  MAX_ROSTER_ROWS,
  normalizeRosterMobile,
  planRosterImport,
  rosterEntryFromRow,
  rosterMatchKey,
  rosterNameKey,
  type ParsedRoster,
  type RosterEntry,
  type RosterEntryData,
  type RosterImportPlan,
  type RosterInput,
} from "@/lib/roster";

const ROSTER_COLLECTION = "roster";
const META_COLLECTION = "rosterMeta";
const LAST_IMPORT_DOC = "lastImport";
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

    transaction.set(ref, data);
    return toEntry(id, data);
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

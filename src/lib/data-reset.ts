/**
 * Admin data reset. Each category is independent so a rehearsal can be
 * cleaned up (check-ins, portraits) without re-importing the guest list.
 * Every reset is logged to `adminLog`, which no reset ever deletes.
 */

import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { getBucket, getDb, isFirebaseEmulator } from "@/lib/firebase-admin";
import { resetSpendCache } from "@/lib/image-spend";
import { RosterInputError } from "@/lib/roster";
import { RosterUnavailableError } from "@/lib/roster-store";
import {
  RESET_CATEGORIES,
  RESET_CONFIRMATION,
  type ResetCategory,
  type ResetCounts,
  type ResetLog,
} from "@/lib/data-reset-shared";
import { deleteAllLocalSessions } from "@/lib/sessions";

export {
  RESET_CATEGORIES,
  RESET_CONFIRMATION,
  type ResetCategory,
  type ResetCounts,
  type ResetLog,
} from "@/lib/data-reset-shared";

const CATEGORY_KEYS = new Set<string>(RESET_CATEGORIES.map((category) => category.key));
const LOG_COLLECTION = "adminLog";
const BATCH_SIZE = 400;

function requireDb(): Firestore {
  const db = getDb();
  if (!db) throw new RosterUnavailableError();
  return db;
}

export function parseResetCategories(raw: unknown): ResetCategory[] {
  const list =
    typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const categories = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  if (!categories.length) {
    throw new RosterInputError("請至少選擇一項要重置的資料。");
  }
  for (const category of categories) {
    if (!CATEGORY_KEYS.has(category)) {
      throw new RosterInputError(`未知的重置項目：${category}`);
    }
  }
  return categories as ResetCategory[];
}

export function parseResetRequest(body: unknown) {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (record.confirmation !== RESET_CONFIRMATION) {
    throw new RosterInputError(`請輸入「${RESET_CONFIRMATION}」以確認。`);
  }
  return parseResetCategories(record.categories);
}

/** Which collections a backup of these categories has to contain. */
function backupCollections(categories: ResetCategory[]) {
  const names = new Set<string>();
  if (categories.includes("roster") || categories.includes("checkIns")) {
    names.add("roster");
    names.add("rosterMeta");
  }
  if (categories.includes("portraits")) {
    names.add("roster");
    names.add("sessions");
    names.add("identities");
  }
  if (categories.includes("usage")) names.add("usage");
  return [...names].sort();
}

/**
 * Everything a reset of these categories would delete or change, as JSON.
 * Photos in Storage are not included (too large); the archive records that
 * point to them are.
 */
export async function buildResetBackup(categories: ResetCategory[]) {
  const db = requireDb();
  const collections: Record<string, { id: string; data: unknown }[]> = {};
  for (const name of backupCollections(categories)) {
    const snapshot = await db.collection(name).get();
    collections[name] = snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  }
  return {
    kind: "zhisheng-bloom-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    environment: isFirebaseEmulator() ? "emulator" : "live",
    categories,
    collections,
  };
}

/** Current sizes, so the admin sees what each box would remove. */
export async function readResetPreview() {
  const db = requireDb();
  const count = async (name: string) =>
    (await db.collection(name).count().get()).data().count;
  const checkedIn = (
    await db.collection("roster").where("checkedInAt", "!=", null).count().get()
  ).data().count;

  const [roster, sessions, usage, lastReset] = await Promise.all([
    count("roster"),
    count("sessions"),
    count("usage"),
    readLastReset(),
  ]);
  return {
    environment: isFirebaseEmulator() ? ("emulator" as const) : ("live" as const),
    counts: { roster, checkedIn, sessions, usage },
    lastReset,
  };
}

export async function readLastReset(): Promise<ResetLog | null> {
  const db = requireDb();
  const snapshot = await db.collection(LOG_COLLECTION).orderBy("at", "desc").limit(1).get();
  return (snapshot.docs[0]?.data() as ResetLog | undefined) ?? null;
}

async function deleteCollection(db: Firestore, name: string) {
  const ref = db.collection(name);
  const total = (await ref.count().get()).data().count;
  await db.recursiveDelete(ref);
  return total;
}

/** Applies the same field changes to every roster entry, in batches. */
async function updateAllRoster(db: Firestore, changes: Record<string, unknown>) {
  const snapshot = await db.collection("roster").get();
  for (let start = 0; start < snapshot.docs.length; start += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of snapshot.docs.slice(start, start + BATCH_SIZE)) {
      batch.update(doc.ref, changes);
    }
    await batch.commit();
  }
  return snapshot.docs.length;
}

async function deleteStoragePrefixes(prefixes: string[]) {
  const bucket = getBucket();
  if (!bucket) return 0;
  let removed = 0;
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix });
    if (!files.length) continue;
    await bucket.deleteFiles({ prefix, force: true });
    removed += files.length;
  }
  return removed;
}

export async function resetData(categories: ResetCategory[]): Promise<ResetLog> {
  const db = requireDb();
  const selected = new Set(categories);
  const counts: ResetCounts = {};

  if (selected.has("portraits")) {
    counts.sessions = await deleteCollection(db, "sessions");
    counts.identities = await deleteCollection(db, "identities");
    counts.storageFiles = await deleteStoragePrefixes(["sessions/", "identities/"]);
    counts.localSessions = await deleteAllLocalSessions();
  }

  if (selected.has("roster")) {
    counts.rosterEntries = await deleteCollection(db, "roster");
    await db.collection("rosterMeta").doc("lastImport").delete();
  } else {
    const changes: Record<string, unknown> = {};
    if (selected.has("checkIns")) {
      Object.assign(changes, {
        checkedInAt: null,
        checkInSource: null,
        portraitAccessToken: null,
        portraitAccessExpiresAt: null,
      });
    }
    if (selected.has("portraits")) {
      // The sessions are gone, so links and statuses would point at nothing.
      Object.assign(changes, {
        portraitSessionId: null,
        portraitStatus: null,
        portraitUpdatedAt: null,
        portraitAccessToken: null,
        portraitAccessExpiresAt: null,
        // Their portraits are gone, so everyone may submit a photo again.
        photoSubmittedAt: null,
      });
    }
    if (Object.keys(changes).length) {
      const updated = await updateAllRoster(db, changes);
      if (selected.has("checkIns")) counts.checkInsCleared = updated;
      if (selected.has("portraits")) counts.portraitLinksCleared = updated;
    }
  }

  if (selected.has("roster") || selected.has("checkIns")) {
    // A fresh start for arrivals: guests cannot check in until reopened.
    await db
      .collection("rosterMeta")
      .doc("checkIn")
      .set({ open: false, updatedAt: new Date().toISOString() });
  }

  if (selected.has("usage")) {
    counts.usageDays = await deleteCollection(db, "usage");
    resetSpendCache();
  }

  const log: ResetLog = {
    at: new Date().toISOString(),
    categories,
    counts,
    environment: isFirebaseEmulator() ? "emulator" : "live",
  };
  await db.collection(LOG_COLLECTION).add({ ...log, loggedAt: FieldValue.serverTimestamp() });
  return log;
}

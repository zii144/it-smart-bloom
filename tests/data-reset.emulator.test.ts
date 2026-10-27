/**
 * The admin data reset against real Firestore + Storage emulators: each
 * category must remove exactly its own data and leave the rest alone.
 * Runs only under `npm run test:emulator`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildResetBackup,
  readLastReset,
  readResetPreview,
  resetData,
} from "@/lib/data-reset";
import { getBucket, getDb } from "@/lib/firebase-admin";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import { parseRosterInput } from "@/lib/roster";
import {
  checkInRosterEntry,
  createRosterEntry,
  findPortraitByAccessToken,
  listRosterEntries,
  readCheckInSettings,
  recordRosterPortrait,
  setCheckInOpen,
} from "@/lib/roster-store";
import {
  createSession,
  deleteAllLocalSessions,
  getSession,
  SessionError,
} from "@/lib/sessions";
import { imageFile } from "./helpers";

const TEST_EMULATOR_HOST = "127.0.0.1:8181";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

async function clearFirestore() {
  const projectId =
    process.env.FIREBASE_PROJECT_ID?.trim() || firebasePublicConfig.projectId;
  const response = await fetch(
    `http://${emulatorHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: "DELETE" },
  );
  if (!response.ok) throw new Error(`Emulator reset failed: ${response.status}`);
}

async function storageFiles(prefix: string) {
  const [files] = await getBucket()!.getFiles({ prefix });
  return files.map((file) => file.name);
}

/** A small but complete event: arrivals, a finished portrait, archive, usage. */
async function seedEvent() {
  const db = getDb()!;
  const arrived = await createRosterEntry(
    parseRosterInput({ name: "甲", mobile: "0911111111", seat: "A1" }),
  );
  await createRosterEntry(parseRosterInput({ name: "乙", mobile: "0922222222", seat: "A2" }));
  await recordRosterPortrait(arrived.id, "sess-1", "complete", { isNewSession: true });
  await setCheckInOpen(true);
  const { portrait } = await checkInRosterEntry(arrived.id, "self");
  await db.collection("rosterMeta").doc("lastImport").set({ importedAt: "x", sheet: "名單" });

  await db.collection("sessions").doc("sess-1").set({ sessionId: "sess-1", status: "complete" });
  await db.collection("identities").doc("mobile_0911111111").set({ sessionIds: ["sess-1"] });
  await getBucket()!.file("sessions/sess-1/result").save(Buffer.from("portrait"));
  await getBucket()!.file("identities/mobile_0911111111/sess-1/input").save(Buffer.from("photo"));
  await db.collection("usage").doc("2026-11-10").set({ count: 3 });
  const local = await createSession(imageFile());

  return { arrivedId: arrived.id, token: portrait.accessToken!, localSessionId: local.id };
}

async function count(name: string) {
  return (await getDb()!.collection(name).count().get()).data().count;
}

describe.skipIf(emulatorHost !== TEST_EMULATOR_HOST)("admin data reset", () => {
  beforeEach(async () => {
    await clearFirestore();
    await getBucket()!.deleteFiles({ force: true }).catch(() => {});
    await deleteAllLocalSessions();
  });

  it("previews current sizes", async () => {
    await seedEvent();
    await expect(readResetPreview()).resolves.toMatchObject({
      environment: "emulator",
      counts: { roster: 2, checkedIn: 1, sessions: 1, usage: 1 },
      lastReset: null,
    });
  });

  it("backs up exactly the collections a reset would touch", async () => {
    await seedEvent();

    const backup = await buildResetBackup(["checkIns", "usage"]);

    expect(backup).toMatchObject({ kind: "zhisheng-bloom-backup", categories: ["checkIns", "usage"] });
    expect(Object.keys(backup.collections).sort()).toEqual(["roster", "rosterMeta", "usage"]);
    expect(backup.collections.roster).toHaveLength(2);
    expect(JSON.stringify(backup.collections.roster)).toContain("checkedInAt");
  });

  it("報到紀錄: clears arrivals and portrait links, keeps guests and portraits", async () => {
    const seeded = await seedEvent();

    const log = await resetData(["checkIns"]);

    expect(log.counts).toEqual({ checkInsCleared: 2 });
    const roster = await listRosterEntries();
    expect(roster).toHaveLength(2);
    expect(roster.every((entry) => !entry.checkedInAt && !entry.portraitAccessToken)).toBe(true);
    expect(roster.find((entry) => entry.name === "甲")?.portraitStatus).toBe("complete");
    await expect(findPortraitByAccessToken(seeded.token)).resolves.toBeNull();
    await expect(readCheckInSettings()).resolves.toMatchObject({ open: false });
    expect(await count("sessions")).toBe(1);
    expect(await count("usage")).toBe(1);
  });

  it("似顏繪: removes sessions, archive, Storage and local copies; keeps arrivals", async () => {
    const seeded = await seedEvent();

    const log = await resetData(["portraits"]);

    expect(log.counts).toMatchObject({
      sessions: 1,
      identities: 1,
      storageFiles: 2,
      localSessions: 1,
      portraitLinksCleared: 2,
    });
    expect(await count("sessions")).toBe(0);
    expect(await count("identities")).toBe(0);
    expect(await storageFiles("sessions/")).toEqual([]);
    expect(await storageFiles("identities/")).toEqual([]);
    await expect(getSession(seeded.localSessionId)).rejects.toThrow(SessionError);

    const roster = await listRosterEntries();
    expect(roster).toHaveLength(2);
    expect(roster.every((entry) => !entry.portraitStatus && !entry.portraitSessionId)).toBe(true);
    // Their portraits are gone, so everyone may submit a photo again.
    expect(roster.every((entry) => entry.photoSubmittedAt === null)).toBe(true);
    expect(roster.find((entry) => entry.name === "甲")?.checkedInAt).toBeTruthy();
    await expect(findPortraitByAccessToken(seeded.token)).resolves.toBeNull();
    // Check-in stays open: only a roster or check-in reset closes it.
    await expect(readCheckInSettings()).resolves.toMatchObject({ open: true });
  });

  it("名單: deletes every guest and the import record, closes check-in", async () => {
    await seedEvent();

    const log = await resetData(["roster"]);

    expect(log.counts).toEqual({ rosterEntries: 2 });
    expect(await count("roster")).toBe(0);
    expect((await getDb()!.collection("rosterMeta").doc("lastImport").get()).exists).toBe(false);
    await expect(readCheckInSettings()).resolves.toMatchObject({ open: false });
    expect(await count("sessions")).toBe(1);
    expect(await count("usage")).toBe(1);
  });

  it("用量統計: clears the daily counters only", async () => {
    await seedEvent();

    await expect(resetData(["usage"])).resolves.toMatchObject({ counts: { usageDays: 1 } });

    expect(await count("usage")).toBe(0);
    expect(await count("roster")).toBe(2);
    expect(await count("sessions")).toBe(1);
  });

  it("logs every reset, and the log survives resetting everything", async () => {
    await seedEvent();

    await resetData(["usage"]);
    const full = await resetData(["roster", "checkIns", "portraits", "usage"]);

    expect(await count("roster")).toBe(0);
    expect(await count("sessions")).toBe(0);
    expect(await count("adminLog")).toBe(2);
    await expect(readLastReset()).resolves.toMatchObject({
      at: full.at,
      categories: ["roster", "checkIns", "portraits", "usage"],
      environment: "emulator",
    });
  });
});

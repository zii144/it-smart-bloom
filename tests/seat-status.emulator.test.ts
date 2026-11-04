/** Real transactions, migration and browser security rules; dedicated emulators only. */
import { beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "firebase-admin/auth";
import { getDb, getFirebaseApp } from "@/lib/firebase-admin";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import { parseRosterInput, parseRosterSheets } from "@/lib/roster";
import {
  applyRosterImport, checkInRosterEntry, createRosterEntry, deleteRosterEntry,
  setCheckInOpen, undoRosterCheckIn, updateRosterEntry,
} from "@/lib/roster-store";
import { readSeatStatus, rebuildSeatStatus } from "@/lib/seat-status-store";
import { readSeatGuests } from "@/lib/seat-guest-store";
import { resetData } from "@/lib/data-reset";

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || firebasePublicConfig.projectId;
const base = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents`;
const person = (seat: string) => parseRosterInput({ name: "私人姓名", mobile: "0911111111", seat, note: "不應公開", email: "private@example.com" });

async function displayToken(claims: Record<string, unknown>) {
  const token = await getAuth(getFirebaseApp()!).createCustomToken(`test-display-${crypto.randomUUID()}`, claims);
  const response = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=test`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Auth emulator exchange failed: ${response.status}`);
  return (await response.json()).idToken as string;
}

describe.skipIf(firestoreHost !== "127.0.0.1:8181" || authHost !== "127.0.0.1:9198")("seat-status pipeline and security rules", () => {
  beforeEach(async () => {
    const response = await fetch(`http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: "DELETE" });
    if (!response.ok) throw new Error("Test emulator reset failed");
  });

  it("keeps create, concurrent check-in, seat edits, import, undo and delete in sync", async () => {
    const entry = await createRosterEntry(person("A1"));
    expect((await readSeatStatus()).entries).toEqual([{ id: entry.id, seat: "A1", checkedInAt: null }]);
    const arrivals = await Promise.all([checkInRosterEntry(entry.id, "self"), checkInRosterEntry(entry.id, "admin")]);
    expect(arrivals[0].checkedInAt).toBe(arrivals[1].checkedInAt);
    await updateRosterEntry(entry.id, person("B2"));
    await applyRosterImport(parseRosterSheets([{ sheet: "座位", data: [["姓名", "手機", "座位"], ["私人姓名", "0911111111", "C3"]] }]));
    expect((await readSeatStatus()).entries).toEqual([{ id: entry.id, seat: "C3", checkedInAt: arrivals[0].checkedInAt }]);
    const raw = (await getDb()!.collection("seatStatus").doc(entry.id).get()).data();
    expect(Object.keys(raw!).sort()).toEqual(["checkedInAt", "seat"]);
    await undoRosterCheckIn(entry.id);
    expect((await readSeatStatus()).entries[0].checkedInAt).toBeNull();
    await deleteRosterEntry(entry.id);
    expect((await readSeatStatus()).entries).toEqual([]);
  });

  it("backfills legacy arrivals, deletes orphans and safely races a live check-in", async () => {
    const db = getDb()!;
    await db.collection("roster").doc("legacy").set(person("A1"));
    await db.collection("seatStatus").doc("deleted").set({ seat: "Z9", checkedInAt: "old" });
    await Promise.all([rebuildSeatStatus(), checkInRosterEntry("legacy", "self")]);
    const source = (await db.collection("roster").doc("legacy").get()).data()!;
    expect((await readSeatStatus()).entries).toEqual([{ id: "legacy", seat: "A1", checkedInAt: source.checkedInAt }]);
    await rebuildSeatStatus();
    expect((await readSeatStatus()).entries).toHaveLength(1);
  });

  it("looks up only safe guest fields and excludes stale seat assignments", async () => {
    const entry = await createRosterEntry(person("a1"));
    const checked = await checkInRosterEntry(entry.id, "admin");
    expect(await readSeatGuests("A1", [entry.id])).toEqual([
      { id: entry.id, name: "私人姓名", role: "", seat: "A1", checkedInAt: checked.checkedInAt },
    ]);
    await updateRosterEntry(entry.id, person("B2"));
    expect(await readSeatGuests("A1", [entry.id])).toEqual([]);
    await deleteRosterEntry(entry.id);
    expect(await readSeatGuests("B2", [entry.id])).toEqual([]);
  });

  it("mirrors open/closed settings and clears the display with event resets", async () => {
    const entry = await createRosterEntry(person("A1"));
    await checkInRosterEntry(entry.id, "admin");
    await setCheckInOpen(true);
    expect((await readSeatStatus()).checkIn.open).toBe(true);
    await resetData(["checkIns"]);
    expect(await readSeatStatus()).toMatchObject({ entries: [{ seat: "A1", checkedInAt: null }], checkIn: { open: false } });
    await resetData(["roster"]);
    expect((await readSeatStatus()).entries).toHaveLength(0);
  });

  it("imports more than one paired-write chunk without losing entries", async () => {
    const rows = Array.from({ length: 205 }, (_, index) => [`來賓${index}`, `09${String(index).padStart(8, "0")}`, `A${index + 1}`]);
    await applyRosterImport(parseRosterSheets([{ sheet: "座位", data: [["姓名", "手機", "座位"], ...rows] }]));
    expect((await readSeatStatus()).entries).toHaveLength(205);
  });

  it("keeps the projection consistent when a seat edit races an arrival reset", async () => {
    const entry = await createRosterEntry(person("A1"));
    await checkInRosterEntry(entry.id, "admin");
    await Promise.all([resetData(["checkIns"]), updateRosterEntry(entry.id, person("B3"))]);
    const source = (await getDb()!.collection("roster").doc(entry.id).get()).data()!;
    expect((await readSeatStatus()).entries).toEqual([{ id: entry.id, seat: source.seat, checkedInAt: source.checkedInAt }]);
  });

  it("allows scoped display reads but rejects private reads, writes, unauthenticated and expired sessions", async () => {
    const entry = await createRosterEntry(person("A1"));
    await setCheckInOpen(true);
    const token = await displayToken({ seatStatusDisplay: true, seatStatusExpiresAt: Date.now() + 60_000 });
    const headers = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${base}/seatStatus`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/seatStatusMeta/checkIn`, { headers })).status).toBe(200);
    expect((await fetch(`${base}/roster/${entry.id}`, { headers })).status).toBe(403);
    expect((await fetch(`${base}/seatStatusMeta/schema`, { headers })).status).toBe(403);
    expect((await fetch(`${base}/seatStatus/${entry.id}`, {
      method: "PATCH", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { seat: { stringValue: "hacked" } } }),
    })).status).toBe(403);
    expect((await fetch(`${base}/seatStatus`)).status).toBe(403);
    const expired = await displayToken({ seatStatusDisplay: true, seatStatusExpiresAt: Date.now() - 60_000 });
    expect((await fetch(`${base}/seatStatus`, { headers: { Authorization: `Bearer ${expired}` } })).status).toBe(403);
    const unscoped = await displayToken({});
    expect((await fetch(`${base}/seatStatus`, { headers: { Authorization: `Bearer ${unscoped}` } })).status).toBe(403);
  });
});

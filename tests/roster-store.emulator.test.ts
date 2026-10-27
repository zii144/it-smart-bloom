/**
 * Runs `roster-store` against a real Firestore emulator: transactions, the
 * matchKey query and batched writes behave differently from any mock.
 *
 * Every test wipes the emulator, so it only runs against the dedicated test
 * emulator from `npm run test:emulator` (firebase.emulator-test.json, port
 * 8181) — never the dev emulator on 8080 that holds your local data.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import { parseRosterInput, parseRosterSheets } from "@/lib/roster";
import {
  applyRosterImport,
  checkInRosterEntry,
  createRosterEntry,
  deleteRosterEntry,
  findPortraitByAccessToken,
  findRosterMatch,
  allowPhotoResubmission,
  isPhotoSubmitted,
  PhotoAlreadySubmittedError,
  releasePhotoSubmission,
  reservePhotoSubmission,
  listRosterEntries,
  readCheckInSettings,
  readLastImport,
  readRosterGuest,
  recordRosterPortrait,
  RosterConflictError,
  RosterNotFoundError,
  setCheckInOpen,
  undoRosterCheckIn,
  updateRosterEntry,
} from "@/lib/roster-store";

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

function person(name: string, mobile: string | null, extra: Record<string, unknown> = {}) {
  return parseRosterInput({ name, mobile: mobile ?? "", ...extra });
}

function sheet(rows: unknown[][]) {
  return parseRosterSheets([
    { sheet: "名單", data: [["座位", "姓名", "手機", "備註"], ...rows] },
  ]);
}

describe.skipIf(emulatorHost !== TEST_EMULATOR_HOST)("roster-store on the Firestore emulator", () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it("matches on name + mobile however the guest types them", async () => {
    const created = await createRosterEntry(person("張小明", "0912345678"));

    await expect(findRosterMatch("張小明", "0912345678")).resolves.toEqual({
      id: created.id,
    });
    await expect(findRosterMatch(" 張 小明 ", "0912-345-678")).resolves.toEqual({
      id: created.id,
    });
    await expect(findRosterMatch("張小明", "0987654321")).resolves.toBeNull();
    await expect(findRosterMatch("張大明", "0912345678")).resolves.toBeNull();
  });

  it("never matches someone without a mobile", async () => {
    await createRosterEntry(person("無手機", null));
    await expect(findRosterMatch("無手機", "")).resolves.toBeNull();
  });

  it("refuses a second entry with the same name + mobile", async () => {
    await createRosterEntry(person("張小明", "0912345678"));
    await expect(createRosterEntry(person("張小明", "0912-345-678"))).rejects.toThrow(
      RosterConflictError,
    );
    // Same mobile, different person (family phone) is allowed.
    await expect(createRosterEntry(person("張媽媽", "0912345678"))).resolves.toBeTruthy();
  });

  it("re-keys on edit so only the new details match", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111", { seat: "A1" }));

    const updated = await updateRosterEntry(entry.id, person("甲", "0922222222", { seat: "A1" }));

    expect(updated).toMatchObject({ matchKey: "甲|0922222222", createdAt: entry.createdAt });
    await expect(findRosterMatch("甲", "0911111111")).resolves.toBeNull();
    await expect(findRosterMatch("甲", "0922222222")).resolves.toEqual({ id: entry.id });
  });

  it("blocks an edit that would collide with someone else", async () => {
    await createRosterEntry(person("甲", "0911111111"));
    const other = await createRosterEntry(person("乙", "0922222222"));

    await expect(updateRosterEntry(other.id, person("甲", "0911111111"))).rejects.toThrow(
      RosterConflictError,
    );
    // Saving an entry unchanged is not a collision with itself.
    await expect(updateRosterEntry(other.id, person("乙", "0922222222"))).resolves.toBeTruthy();
  });

  it("reports missing entries on edit and delete", async () => {
    await expect(updateRosterEntry("nope", person("甲", null))).rejects.toThrow(
      RosterNotFoundError,
    );
    await expect(deleteRosterEntry("nope")).rejects.toThrow(RosterNotFoundError);
  });

  it("deletes an entry so it no longer matches", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111"));
    await deleteRosterEntry(entry.id);
    await expect(findRosterMatch("甲", "0911111111")).resolves.toBeNull();
  });

  it("imports, then merges a second import without duplicating anyone", async () => {
    const first = await applyRosterImport(
      sheet([
        ["A2", "甲", "0911111111", null],
        ["A10", "乙", null, null],
        ["A1", "丙", "0933333333", "原備註"],
      ]),
    );
    expect(first.creates).toHaveLength(3);
    expect((await listRosterEntries()).map((entry) => entry.seat)).toEqual([
      "A1",
      "A2",
      "A10",
    ]);

    // An admin fixes 乙's mobile by hand between imports.
    const yi = (await listRosterEntries()).find((entry) => entry.name === "乙")!;
    await updateRosterEntry(yi.id, person("乙", "0922222222", { seat: "A10" }));

    const second = await applyRosterImport(
      sheet([
        ["A2", "甲", "0911111111", "新備註"],
        ["A10", "乙", null, null],
        ["A1", "丙", "0933333333", null],
        ["B1", "丁", "0944444444", null],
      ]),
    );

    expect(second.creates.map((row) => row.name)).toEqual(["丁"]);
    expect(second.updates.map((update) => [update.row.name, update.changes])).toEqual([
      ["甲", ["備註"]],
    ]);
    expect(second.unchanged).toBe(2);

    const entries = await listRosterEntries();
    expect(entries).toHaveLength(4);
    const byName = Object.fromEntries(entries.map((entry) => [entry.name, entry]));
    expect(byName["甲"]?.note).toBe("新備註");
    // A blank cell in the sheet did not erase the admin's fix or 丙's note.
    expect(byName["乙"]?.mobile).toBe("0922222222");
    expect(byName["丙"]?.note).toBe("原備註");
    await expect(findRosterMatch("乙", "0922222222")).resolves.toEqual({ id: yi.id });

    await expect(readLastImport()).resolves.toMatchObject({
      sheet: "名單",
      created: 1,
      updated: 1,
      unchanged: 2,
    });
  });

  it("writes imports larger than one Firestore batch", async () => {
    const rows = Array.from({ length: 450 }, (_, index) => [
      `S${index}`,
      `來賓${index}`,
      `09${String(index).padStart(8, "0")}`,
      null,
    ]);

    const plan = await applyRosterImport(sheet(rows));

    expect(plan.creates).toHaveLength(450);
    expect(await listRosterEntries()).toHaveLength(450);
    await expect(findRosterMatch("來賓449", "0900000449")).resolves.not.toBeNull();
  });

  it("keeps check-in closed until an admin opens it", async () => {
    await expect(readCheckInSettings()).resolves.toMatchObject({ open: false });
    await setCheckInOpen(true);
    await expect(readCheckInSettings()).resolves.toMatchObject({ open: true });
    await setCheckInOpen(false);
    await expect(readCheckInSettings()).resolves.toMatchObject({ open: false });
  });

  it("checks in once and keeps the first arrival time", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111", { seat: "A1" }));

    const first = await checkInRosterEntry(entry.id, "self");
    const again = await checkInRosterEntry(entry.id, "admin");

    expect(first).toMatchObject({ name: "甲", seat: "A1", alreadyCheckedIn: false });
    expect(again).toEqual({ ...first, alreadyCheckedIn: true });
    expect(first.portrait).toEqual({ status: null, accessToken: null });
    const stored = (await listRosterEntries())[0]!;
    expect(stored).toMatchObject({ checkedInAt: first.checkedInAt, checkInSource: "self" });

    await undoRosterCheckIn(entry.id);
    expect((await listRosterEntries())[0]).toMatchObject({
      checkedInAt: null,
      checkInSource: null,
    });
    await expect(checkInRosterEntry("nope", "self")).rejects.toThrow(RosterNotFoundError);
  });

  it("hands the finished portrait over at check-in, and only then", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111"));

    // Still painting: arrival is recorded, but no portrait link yet.
    await recordRosterPortrait(entry.id, "sess-1", "generating", { isNewSession: true });
    const early = await checkInRosterEntry(entry.id, "self");
    expect(early.portrait).toEqual({ status: "generating", accessToken: null });

    // Finished: checking in again (keeping the first time) hands it over.
    await recordRosterPortrait(entry.id, "sess-1", "complete", { isNewSession: false });
    const later = await checkInRosterEntry(entry.id, "self");
    expect(later).toMatchObject({ alreadyCheckedIn: true, checkedInAt: early.checkedInAt });
    expect(later.portrait.status).toBe("complete");
    expect(later.portrait.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await expect(findPortraitByAccessToken(later.portrait.accessToken!)).resolves.toEqual({
      sessionId: "sess-1",
      name: "甲",
    });

    // A newer check-in replaces the link; the old one stops working.
    const again = await checkInRosterEntry(entry.id, "self");
    await expect(findPortraitByAccessToken(later.portrait.accessToken!)).resolves.toBeNull();
    await expect(findPortraitByAccessToken(again.portrait.accessToken!)).resolves.not.toBeNull();

    // Undoing the arrival takes the link back too.
    await undoRosterCheckIn(entry.id);
    await expect(findPortraitByAccessToken(again.portrait.accessToken!)).resolves.toBeNull();
  });

  it("refuses expired, malformed and superseded portrait links", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111"));
    await recordRosterPortrait(entry.id, "sess-1", "complete", { isNewSession: true });
    const { portrait } = await checkInRosterEntry(entry.id, "self");
    const token = portrait.accessToken!;

    await expect(findPortraitByAccessToken("not-a-token")).resolves.toBeNull();

    // A new booth session that is still painting replaces the finished one.
    await recordRosterPortrait(entry.id, "sess-2", "generating", { isNewSession: true });
    await expect(findPortraitByAccessToken(token)).resolves.toBeNull();

    await recordRosterPortrait(entry.id, "sess-2", "complete", { isNewSession: false });
    const fresh = (await checkInRosterEntry(entry.id, "self")).portrait.accessToken!;
    const realNow = Date.now;
    Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
    try {
      await expect(findPortraitByAccessToken(fresh)).resolves.toBeNull();
    } finally {
      Date.now = realNow;
    }
  });

  it("tracks the one photo submission, including entries from before the rule", async () => {
    const fresh = await createRosterEntry(person("甲", "0911111111"));
    await expect(isPhotoSubmitted(fresh.id)).resolves.toBe(false);

    const claim = await reservePhotoSubmission(fresh.id);
    await expect(isPhotoSubmitted(fresh.id)).resolves.toBe(true);
    await expect(reservePhotoSubmission(fresh.id)).rejects.toThrow(PhotoAlreadySubmittedError);

    // Releasing someone else's (older) claim must not unlock a newer one.
    await releasePhotoSubmission(fresh.id, "2000-01-01T00:00:00.000Z");
    await expect(isPhotoSubmitted(fresh.id)).resolves.toBe(true);
    await releasePhotoSubmission(fresh.id, claim);
    await expect(isPhotoSubmitted(fresh.id)).resolves.toBe(false);

    // A guest with a portrait from before the rule counts as submitted…
    const legacy = await createRosterEntry(person("乙", "0922222222"));
    await recordRosterPortrait(legacy.id, "old-session", "complete", { isNewSession: true });
    await expect(isPhotoSubmitted(legacy.id)).resolves.toBe(true);
    // …until an admin allows another.
    await allowPhotoResubmission(legacy.id);
    await expect(isPhotoSubmitted(legacy.id)).resolves.toBe(false);
    await expect(allowPhotoResubmission("nope")).rejects.toThrow(RosterNotFoundError);
  });

  it("only finished portraits use up the submission", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111"));
    await reservePhotoSubmission(entry.id);
    await recordRosterPortrait(entry.id, "s1", "generating", { isNewSession: true });
    await expect(isPhotoSubmitted(entry.id)).resolves.toBe(true);

    // The render fails: the guest gets their submission back.
    await recordRosterPortrait(entry.id, "s1", "failed", { isNewSession: false });
    await expect(isPhotoSubmitted(entry.id)).resolves.toBe(false);

    // A retry of that same session succeeds: it counts again.
    await recordRosterPortrait(entry.id, "s1", "complete", { isNewSession: false });
    await expect(isPhotoSubmitted(entry.id)).resolves.toBe(true);

    // A late failure from an older session never unlocks a newer submission.
    await allowPhotoResubmission(entry.id);
    await reservePhotoSubmission(entry.id);
    await recordRosterPortrait(entry.id, "s2", "ready", { isNewSession: true });
    await recordRosterPortrait(entry.id, "s1", "failed", { isNewSession: false });
    await expect(isPhotoSubmitted(entry.id)).resolves.toBe(true);
  });

  it("does not count a legacy portrait that failed", async () => {
    const legacy = await createRosterEntry(person("乙", "0922222222"));
    await recordRosterPortrait(legacy.id, "old", "generating", { isNewSession: true });
    // Simulate an entry from before the rule: drop the flag the mirror wrote.
    const { getDb } = await import("@/lib/firebase-admin");
    const { FieldValue } = await import("firebase-admin/firestore");
    await getDb()!.collection("roster").doc(legacy.id).update({
      photoSubmittedAt: FieldValue.delete(),
      portraitStatus: "failed",
    });
    await expect(isPhotoSubmitted(legacy.id)).resolves.toBe(false);
  });

  it("keeps the submission flag through admin edits and re-imports", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111", { seat: "A1" }));
    await reservePhotoSubmission(entry.id);

    await updateRosterEntry(entry.id, person("甲", "0911111111", { seat: "B2" }));
    await applyRosterImport(sheet([["C3", "甲", "0911111111", null]]));

    await expect(isPhotoSubmitted(entry.id)).resolves.toBe(true);
  });

  it("keeps arrival and portrait state through admin edits and re-imports", async () => {
    await applyRosterImport(sheet([["A1", "甲", "0911111111", null]]));
    const [entry] = await listRosterEntries();
    const arrival = await checkInRosterEntry(entry!.id, "self");
    await recordRosterPortrait(entry!.id, "sess-1", "complete", { isNewSession: true });

    await updateRosterEntry(entry!.id, person("甲", "0911111111", { seat: "B2" }));
    await applyRosterImport(sheet([["C3", "甲", "0911111111", "新備註"]]));

    const [after] = await listRosterEntries();
    expect(after).toMatchObject({
      seat: "C3",
      note: "新備註",
      checkedInAt: arrival.checkedInAt,
      checkInSource: "self",
      portraitSessionId: "sess-1",
      portraitStatus: "complete",
    });
  });

  it("mirrors the latest session's portrait status and ignores older ones", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111"));

    await recordRosterPortrait(entry.id, "old", "generating", { isNewSession: true });
    await recordRosterPortrait(entry.id, "new", "ready", { isNewSession: true });
    // The first session finishing late must not overwrite the newer one.
    await recordRosterPortrait(entry.id, "old", "complete", { isNewSession: false });
    await recordRosterPortrait(entry.id, "new", "generating", { isNewSession: false });

    expect((await listRosterEntries())[0]).toMatchObject({
      portraitSessionId: "new",
      portraitStatus: "generating",
    });
  });

  it("never recreates a deleted entry from a portrait update", async () => {
    const entry = await createRosterEntry(person("甲", "0911111111"));
    await deleteRosterEntry(entry.id);

    await recordRosterPortrait(entry.id, "sess", "complete", { isNewSession: true });

    expect(await listRosterEntries()).toEqual([]);
    await expect(readRosterGuest(entry.id)).resolves.toBeNull();
  });

  it("reads only name and seat for the success card", async () => {
    const entry = await createRosterEntry(
      person("甲", "0911111111", { seat: "A9", address: "某市某路 1 號" }),
    );
    await expect(readRosterGuest(entry.id)).resolves.toEqual({ name: "甲", seat: "A9" });
  });
});

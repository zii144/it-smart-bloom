/**
 * Admin overview reads of the `sessions` archive against the Firestore
 * emulator: whole-collection counts and cursor paging past the first batch.
 * Runs only under `npm run test:emulator`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/firebase-admin";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import { countArchiveSessions, listArchiveSessions } from "@/lib/portrait-archive";

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

/** `count` sessions, one minute apart; every third failed, the rest complete. */
async function seedSessions(count: number) {
  const batch = getDb()!.batch();
  for (let index = 0; index < count; index += 1) {
    const id = `sess-${String(index).padStart(3, "0")}`;
    batch.set(getDb()!.collection("sessions").doc(id), {
      sessionId: id,
      status: index % 3 === 0 ? "failed" : "complete",
      createdAt: new Date(Date.UTC(2026, 9, 29, 5, index)).toISOString(),
      storage: { inputPath: null, resultPath: null },
    });
  }
  await batch.commit();
}

describe.skipIf(emulatorHost !== TEST_EMULATOR_HOST)("portrait archive overview", () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it("counts the whole collection, not just the listed page", async () => {
    await seedSessions(60);

    expect(await countArchiveSessions()).toEqual({
      total: 60,
      complete: 40,
      failed: 20,
    });
  });

  it("pages past the first 50 with a createdAt cursor", async () => {
    await seedSessions(60);

    const first = await listArchiveSessions({ limit: 50 });
    expect(first.sessions).toHaveLength(50);
    expect(first.sessions[0].sessionId).toBe("sess-059");

    const older = await listArchiveSessions({
      limit: 50,
      before: first.sessions.at(-1)!.createdAt,
    });
    expect(older.sessions.map((row) => row.sessionId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `sess-${String(9 - index).padStart(3, "0")}`),
    );
  });
});

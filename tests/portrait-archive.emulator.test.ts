/**
 * Admin overview reads of the `sessions` archive against the Firestore
 * emulator: whole-collection counts and cursor paging past the first batch,
 * plus the admin's adjusted-portrait pointer (Storage emulator).
 * Runs only under `npm run test:emulator`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getBucket, getDb } from "@/lib/firebase-admin";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import {
  archiveSessionStatus,
  clearFinalResult,
  completeSessionWithFinal,
  countArchiveSessions,
  listArchiveSessions,
  readArchiveImage,
  finalizeUploadedFinalResult,
  FinalResultInputError,
  readArchiveRecord,
  storeFinalResult,
} from "@/lib/portrait-archive";
import { getSession, readResultImage } from "@/lib/sessions";
import { previewInfo, realImage } from "./helpers";

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

  it("stores each adjusted upload separately and clears only the pointer", async () => {
    await seedSessions(1);
    const firstBytes = await realImage("png", { width: 2400, height: 1800 });
    const first = await storeFinalResult("sess-000", { bytes: firstBytes, mime: "image/png" });
    expect(first.path).toBe(`sessions/sess-000/final/${first.revisionId}`);
    expect(first.size).toBe(firstBytes.length);
    expect((await readArchiveRecord("sess-000"))?.finalResult).toEqual(first);
    // The generated result is untouched.
    expect((await readArchiveRecord("sess-000"))?.storage.resultPath).toBeNull();
    // Its compressed preview is ready before guests can see it.
    const preview = await readArchiveImage(first.previewPath!);
    expect(await previewInfo(preview!.bytes)).toEqual({
      format: "jpeg",
      width: 1280,
      height: 960,
    });

    const second = await storeFinalResult("sess-000", {
      bytes: await realImage("webp"),
      mime: "image/webp",
    });
    expect(second.path).not.toBe(first.path);
    expect((await readArchiveImage(first.path))?.bytes.length).toBe(firstBytes.length);

    await clearFinalResult("sess-000");
    expect((await readArchiveRecord("sess-000"))?.finalResult).toBeNull();
    expect(await readArchiveImage(second.path)).not.toBeNull();
  });

  it("re-uploads checked staging bytes to final/, and deletes a bad upload", async () => {
    await seedSessions(1);
    const bucket = getBucket()!;
    const staged = "sessions/sess-000/uploads/upload-1";
    const bytes = await realImage("jpeg", { width: 300, height: 200 });
    await bucket.file(staged).save(bytes, { contentType: "image/jpeg" });

    const accepted = await finalizeUploadedFinalResult("sess-000", staged);
    expect(accepted).toMatchObject({ mime: "image/jpeg", size: bytes.length });
    expect(accepted.path).toBe(`sessions/sess-000/final/${accepted.revisionId}`);
    expect((await readArchiveImage(accepted.path))?.bytes).toEqual(bytes);
    expect((await readArchiveRecord("sess-000"))?.finalResult?.path).toBe(accepted.path);
    // The staging copy is gone, and a later PUT there cannot reach guests.
    expect((await bucket.file(staged).exists())[0]).toBe(false);
    await bucket.file(staged).save(Buffer.from("swapped"), { contentType: "image/jpeg" });
    expect((await readArchiveImage(accepted.path))?.bytes).toEqual(bytes);

    // Renamed junk is refused and removed; the current adjustment stays.
    const junk = "sessions/sess-000/uploads/upload-2";
    await bucket.file(junk).save(Buffer.from("definitely not a png"), { contentType: "image/png" });
    await expect(finalizeUploadedFinalResult("sess-000", junk)).rejects.toBeInstanceOf(
      FinalResultInputError,
    );
    expect((await bucket.file(junk).exists())[0]).toBe(false);
    expect((await readArchiveRecord("sess-000"))?.finalResult?.path).toBe(accepted.path);

    // Only this session's own staging folder is accepted.
    for (const path of [
      "sessions/other/uploads/upload-1",
      accepted.path,
      "sessions/sess-000/result",
      "sessions/sess-000/uploads/../result",
      42,
    ]) {
      await expect(finalizeUploadedFinalResult("sess-000", path)).rejects.toBeInstanceOf(
        FinalResultInputError,
      );
    }
    expect((await readArchiveImage(accepted.path))?.bytes).toEqual(bytes);
    await expect(
      finalizeUploadedFinalResult("sess-000", "sessions/sess-000/uploads/missing"),
    ).rejects.toBeInstanceOf(FinalResultInputError);
  });

  it("completes a failed render from the admin's upload, once", async () => {
    const id = "failedRenderAbCdEfGh0123456789xy"; // the real 32-character shape
    await getDb()!.collection("sessions").doc(id).set({
      sessionId: id,
      status: "failed",
      error: "OpenAI 額度不足",
      createdAt: "2026-10-29T05:00:00.000Z",
      inputMime: "image/jpeg",
      storage: { inputPath: null, resultPath: null },
    });
    const bytes = await realImage("jpeg", { width: 300, height: 300 });
    const final = await storeFinalResult(id, { bytes, mime: "image/jpeg" });

    await completeSessionWithFinal(id, final);
    const record = await readArchiveRecord(id);
    expect(record).toMatchObject({ status: "complete", resultMime: "image/jpeg" });
    expect(record?.finalResult?.path).toBe(final.path);
    expect((await readArchiveImage(record!.storage.resultPath!))?.bytes).toEqual(bytes);
    const session = await getSession(id);
    expect(session.status).toBe("complete");
    expect(session.error).toBeUndefined();
    expect(record?.error).toBeNull();
    expect((await readResultImage(id)).bytes).toEqual(bytes);

    // A retried upload does not rewrite the now-complete result.
    const resultAt = record?.resultAt;
    await completeSessionWithFinal(id, final);
    expect((await readArchiveRecord(id))?.resultAt).toBe(resultAt);
  });

  it("archives when the result was written, which keys its preview", async () => {
    await seedSessions(1);
    await archiveSessionStatus({
      id: "sess-000",
      createdAt: "2026-10-29T05:00:00.000Z",
      expiresAt: "2026-10-29T05:15:00.000Z",
      status: "complete",
      inputMime: "image/jpeg",
      resultMime: "image/jpeg",
      resultAt: "2026-10-29T05:03:00.000Z",
    });
    expect((await readArchiveRecord("sess-000"))?.resultAt).toBe("2026-10-29T05:03:00.000Z");
  });
});

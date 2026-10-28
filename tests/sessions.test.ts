import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSession,
  getSession,
  MAX_UPLOAD_BYTES,
  publicSession,
  purgeExpiredSessions,
  readInputImage,
  readResultImage,
  SESSION_TTL_MS,
  updateSession,
  writeResultImage,
} from "@/lib/sessions";
import {
  expiredAt,
  imageFile,
  jpegBytes,
  patchMetadata,
  pngBytes,
  readMetadata,
  webpBytes,
} from "./helpers";

describe("createSession", () => {
  it("stores a ready session with the uploaded photo", async () => {
    const bytes = jpegBytes(128);
    const session = await createSession(imageFile(bytes));

    expect(session.status).toBe("ready");
    expect(session.inputMime).toBe("image/jpeg");
    expect(session.id).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const stored = await readInputImage(session.id);
    expect(Buffer.compare(stored.bytes, bytes)).toBe(0);
    expect(stored.mime).toBe("image/jpeg");
  });

  it("expires 15 minutes after creation", async () => {
    const session = await createSession(imageFile());
    const ttl = Date.parse(session.expiresAt) - Date.parse(session.createdAt);
    expect(ttl).toBe(SESSION_TTL_MS);
  });

  it("persists booth-selected generation options", async () => {
    const options = {
      model: "gpt-image-1" as const,
      quality: "low" as const,
      size: "1024x1024" as const,
      outputFormat: "png" as const,
      outputCompression: 80,
      fakeGenerate: true,
    };
    const session = await createSession(imageFile(), options);
    expect((await readMetadata(session.id)).generationOptions).toEqual(options);
  });

  it("omits generation options when the booth did not choose any", async () => {
    const session = await createSession(imageFile());
    expect(await readMetadata(session.id)).not.toHaveProperty(
      "generationOptions",
    );
  });

  it.each([
    ["image/png", pngBytes()],
    ["image/webp", webpBytes()],
  ])("accepts %s uploads", async (type, bytes) => {
    const session = await createSession(imageFile(bytes, type));
    expect(session.inputMime).toBe(type);
  });

  it("rejects an unsupported file type", async () => {
    await expect(
      createSession(imageFile(jpegBytes(), "image/gif", "a.gif")),
    ).rejects.toMatchObject({ status: 415 });
  });

  it("rejects an empty upload", async () => {
    await expect(
      createSession(imageFile(Buffer.alloc(0))),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects an upload over the size limit", async () => {
    await expect(
      createSession(imageFile(jpegBytes(MAX_UPLOAD_BYTES + 1))),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("rejects a file whose bytes do not match its declared type", async () => {
    const notAJpeg = Buffer.alloc(64, 0x20);
    await expect(createSession(imageFile(notAJpeg))).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("getSession", () => {
  it("reads back a stored session", async () => {
    const created = await createSession(imageFile());
    expect(await getSession(created.id)).toEqual(created);
  });

  it("404s an unknown but well-formed id", async () => {
    await expect(getSession("a".repeat(32))).rejects.toMatchObject({
      status: 404,
    });
  });

  it.each(["short", "../../etc/passwd", "has spaces in it here!!", ""])(
    "404s the malformed id %j",
    async (id) => {
      await expect(getSession(id)).rejects.toMatchObject({ status: 404 });
    },
  );

  it("still loads expired metadata for admin/ops paths", async () => {
    const created = await createSession(imageFile());
    await patchMetadata(created.id, { expiresAt: expiredAt() });

    await expect(getSession(created.id)).resolves.toMatchObject({
      id: created.id,
    });
  });
});

describe("assertSessionNotExpired", () => {
  it("rejects guest access after expiresAt", async () => {
    const { assertSessionNotExpired } = await import("@/lib/sessions");
    const created = await createSession(imageFile());
    await patchMetadata(created.id, { expiresAt: expiredAt() });
    const session = await getSession(created.id);

    try {
      assertSessionNotExpired(session);
      expect.unreachable("expired session should throw");
    } catch (error) {
      expect(error).toMatchObject({ status: 410 });
    }
  });
});

describe("updateSession", () => {
  it("merges changes and keeps the identity fields", async () => {
    const created = await createSession(imageFile());
    const updated = await updateSession(created.id, {
      status: "generating",
      generationStartedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(updated).toMatchObject({
      id: created.id,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      status: "generating",
      generationStartedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await getSession(created.id)).toEqual(updated);
  });
});

describe("writeResultImage / readResultImage", () => {
  it("completes the session and serves the rendered portrait", async () => {
    const created = await createSession(imageFile());
    const result = pngBytes(256);

    const completed = await writeResultImage(created.id, result, "image/png");
    expect(completed).toMatchObject({
      status: "complete",
      resultMime: "image/png",
    });

    const read = await readResultImage(created.id);
    expect(Buffer.compare(read.bytes, result)).toBe(0);
    expect(read.mime).toBe("image/png");
    expect(read.size).toBe(result.byteLength);
  });

  it("clears a previous error when a retry succeeds", async () => {
    const created = await createSession(imageFile());
    await updateSession(created.id, { status: "failed", error: "boom" });

    const completed = await writeResultImage(
      created.id,
      jpegBytes(),
      "image/jpeg",
    );
    expect(completed.status).toBe("complete");
    expect(completed.error).toBeUndefined();
  });

  it("409s while the portrait is not finished yet", async () => {
    const created = await createSession(imageFile());
    await expect(readResultImage(created.id)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("purgeExpiredSessions", () => {
  it("can still delete photos marked past the old TTL for ops cleanup", async () => {
    const stale = await createSession(imageFile());
    await writeResultImage(stale.id, jpegBytes(), "image/jpeg");
    await patchMetadata(stale.id, { expiresAt: expiredAt() });

    const live = await createSession(imageFile());

    const removed = await purgeExpiredSessions();

    expect(removed).toBeGreaterThanOrEqual(1);
    await expect(getSession(stale.id)).rejects.toMatchObject({
      status: 404,
    });
    expect((await getSession(live.id)).id).toBe(live.id);
  });

  it("leaves live sessions untouched", async () => {
    const live = await createSession(imageFile());

    await purgeExpiredSessions(Date.now() - SESSION_TTL_MS);

    expect((await getSession(live.id)).id).toBe(live.id);
    expect((await readInputImage(live.id)).bytes.length).toBeGreaterThan(0);
  });

  it("never removes a directory that is still being written", async () => {
    const halfWritten = await createSession(imageFile());
    await rm(
      path.join(process.env.BLOOM_DATA_DIR!, halfWritten.id, "session.json"),
    );

    expect(await purgeExpiredSessions()).toBe(0);
  });

  it("survives a missing data directory", async () => {
    const original = process.env.BLOOM_DATA_DIR;
    process.env.BLOOM_DATA_DIR = path.join(original!, "does-not-exist");

    await expect(purgeExpiredSessions()).resolves.toBe(0);

    process.env.BLOOM_DATA_DIR = original;
  });
});

describe("publicSession", () => {
  it("hides the result url until the portrait is complete", async () => {
    const created = await createSession(imageFile());
    const view = publicSession(created);

    expect(view).toMatchObject({
      id: created.id,
      status: "ready",
      startedAt: null,
      resultUrl: null,
      error: null,
      generationOptions: null,
      inputUrl: `/api/sessions/${created.id}/image?kind=input`,
    });
  });

  it("exposes the result url and start time once complete", async () => {
    const created = await createSession(imageFile());
    await updateSession(created.id, {
      generationStartedAt: "2026-01-01T00:00:00.000Z",
    });
    const completed = await writeResultImage(
      created.id,
      jpegBytes(),
      "image/jpeg",
    );

    expect(publicSession(completed)).toMatchObject({
      status: "complete",
      startedAt: "2026-01-01T00:00:00.000Z",
      resultUrl: `/api/sessions/${created.id}/image?kind=result`,
      error: null,
    });
  });

  it("returns a guest-safe message instead of the raw failure", async () => {
    const created = await createSession(imageFile());
    const failed = await updateSession(created.id, {
      status: "failed",
      error: "OpenAI 429 rate limited: internal trace abc",
    });

    const view = publicSession(failed);
    expect(view.error).toBe("無法完成這次創作，請回到拍照裝置後再試一次。");
    expect(view.error).not.toContain("OpenAI");
  });

  it("never leaks the stored filesystem paths or mime internals", async () => {
    const created = await createSession(imageFile());
    expect(Object.keys(publicSession(created)).sort()).toEqual([
      "createdAt",
      "error",
      "expiresAt",
      "generationAttempts",
      "generationLimit",
      "generationOptions",
      "id",
      "inputUrl",
      "resultMime",
      "resultUrl",
      "startedAt",
      "status",
    ]);
  });
});

describe("serverless session storage", () => {
  it("defaults to /tmp on Vercel when BLOOM_DATA_DIR is unset", async () => {
    const { sessionsDataDir } = await import("@/lib/sessions");
    const originalDir = process.env.BLOOM_DATA_DIR;
    const originalVercel = process.env.VERCEL;
    delete process.env.BLOOM_DATA_DIR;
    process.env.VERCEL = "1";

    expect(sessionsDataDir()).toBe("/tmp/bloom-sessions");

    process.env.BLOOM_DATA_DIR = originalDir;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
  });

  it("hydrates from the Firebase archive when local disk has no copy", async () => {
    const created = await createSession(imageFile(jpegBytes(64)));
    const input = await readInputImage(created.id);

    await rm(path.join(process.env.BLOOM_DATA_DIR!, created.id), {
      recursive: true,
      force: true,
    });

    vi.resetModules();
    vi.doMock("@/lib/portrait-archive", () => ({
      readArchiveRecord: vi.fn(async () => ({
        sessionId: created.id,
        status: "ready",
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
        updatedAt: created.createdAt,
        generationStartedAt: null,
        error: null,
        inputMime: created.inputMime,
        resultMime: null,
        generationOptions: null,
        identityKind: null,
        identityValue: null,
        identityKey: null,
        claimedAt: null,
        avatarRequestedAt: null,
        avatarRequestStatus: "idle",
        avatarRequestError: null,
        storage: {
          inputPath: `sessions/${created.id}/input`,
          resultPath: null,
          identityInputPath: null,
          identityResultPath: null,
        },
      })),
      readArchiveImage: vi.fn(async () => ({
        bytes: input.bytes,
        mime: input.mime,
      })),
    }));

    const {
      getSession: getSessionFresh,
      readInputImage: readInputFresh,
    } = await import("@/lib/sessions");

    await expect(getSessionFresh(created.id)).resolves.toMatchObject({
      id: created.id,
      status: "ready",
    });
    await expect(readInputFresh(created.id)).resolves.toMatchObject({
      mime: "image/jpeg",
    });

    vi.doUnmock("@/lib/portrait-archive");
    vi.resetModules();
  });
});

describe("getSession with a copy on another server instance (QA 10/27)", () => {
  /** The Firestore record another instance wrote, as readArchiveRecord returns it. */
  function archiveRecord(
    session: { id: string; createdAt: string; expiresAt: string; inputMime: string },
    changes: Record<string, unknown>,
  ) {
    return {
      sessionId: session.id,
      status: "ready",
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      updatedAt: session.createdAt,
      generationStartedAt: null,
      generationAttempts: 0,
      error: null,
      inputMime: session.inputMime,
      resultMime: null,
      generationOptions: null,
      identityKind: null,
      identityValue: null,
      identityKey: null,
      claimedAt: null,
      storage: { inputPath: null, resultPath: null, identityInputPath: null, identityResultPath: null },
      ...changes,
    };
  }

  async function withArchive(readArchiveRecord: () => Promise<unknown>) {
    vi.resetModules();
    vi.doMock("@/lib/portrait-archive", () => ({
      readArchiveRecord: vi.fn(readArchiveRecord),
      readArchiveImage: vi.fn(async () => null),
    }));
    return import("@/lib/sessions");
  }

  afterEach(() => {
    vi.doUnmock("@/lib/portrait-archive");
    vi.resetModules();
  });

  it("follows a render that finished on another instance instead of waiting forever", async () => {
    const created = await createSession(imageFile(jpegBytes(64)));
    // This instance cached the session while it was still rendering…
    const stale = await updateSession(created.id, {
      status: "generating",
      generationStartedAt: created.createdAt,
      generationAttempts: 1,
    });
    // …and another instance finished it later.
    const finishedAt = new Date(Date.parse(stale.updatedAt!) + 90_000).toISOString();
    const sessions = await withArchive(async () =>
      archiveRecord(created, {
        status: "complete",
        updatedAt: finishedAt,
        generationStartedAt: created.createdAt,
        generationAttempts: 1,
        resultMime: "image/jpeg",
      }),
    );

    const current = await sessions.getSession(created.id);

    expect(current).toMatchObject({ status: "complete", resultMime: "image/jpeg" });
    expect(sessions.publicSession(current).resultUrl).toContain("kind=result");
    // The local copy is refreshed, so later reads agree even without Firestore.
    const again = await withArchive(async () => null);
    await expect(again.getSession(created.id)).resolves.toMatchObject({ status: "complete" });
  });

  it("keeps its own newer copy while its archive write is still on the way", async () => {
    const created = await createSession(imageFile(jpegBytes(64)));
    await updateSession(created.id, { status: "complete", resultMime: "image/jpeg" });
    const sessions = await withArchive(async () =>
      archiveRecord(created, { status: "generating", updatedAt: created.createdAt }),
    );

    await expect(sessions.getSession(created.id)).resolves.toMatchObject({ status: "complete" });
  });

  it("still answers from the local copy when Firestore cannot be read", async () => {
    const created = await createSession(imageFile(jpegBytes(64)));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const sessions = await withArchive(async () => {
      throw new Error("firestore unavailable");
    });

    await expect(sessions.getSession(created.id)).resolves.toMatchObject({ status: "ready" });
  });
});

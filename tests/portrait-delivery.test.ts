import { beforeEach, describe, expect, it, vi } from "vitest";
import { FUNCTION_BODY_SAFE_BYTES } from "@/lib/portrait-limits";
import {
  originalDownloadResponse,
  readPortraitPreview,
} from "@/lib/portrait-delivery";
import {
  createSession,
  getSession,
  SessionError,
  updateSession,
  writeResultImage,
} from "@/lib/sessions";
import { imageFile, previewInfo, realImage } from "./helpers";

const mocks = vi.hoisted(() => ({
  readRecord: vi.fn(),
  readImage: vi.fn(),
  signUrl: vi.fn(),
  storePreview: vi.fn(),
}));

vi.mock("@/lib/portrait-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portrait-archive")>()),
  readArchiveRecord: mocks.readRecord,
  readArchiveImage: mocks.readImage,
  signedDownloadUrl: mocks.signUrl,
  storePreview: mocks.storePreview,
}));

const generated = await realImage("jpeg", { width: 600, height: 600 });
const adjustedBytes = await realImage("png", { width: 1800, height: 900 });

async function finishedSession(bytes = generated) {
  const session = await createSession(imageFile());
  await writeResultImage(session.id, bytes, "image/jpeg");
  return session;
}

/** An archived session: no `sessionId`, so `getSession` keeps using the local copy. */
function archived(extra: Record<string, unknown> = {}) {
  return {
    status: "complete",
    resultMime: "image/jpeg",
    resultAt: "2026-11-01T04:00:00.000Z",
    storage: { resultPath: "sessions/x/result" },
    ...extra,
  };
}

function withFinal(final: Record<string, unknown> = {}) {
  return archived({
    finalResult: {
      path: "sessions/x/final/r1",
      mime: "image/png",
      revisionId: "r1",
      uploadedAt: "2026-11-01T05:00:00.000Z",
      size: adjustedBytes.length,
      previewPath: "sessions/x/preview/final-r1.jpg",
      ...final,
    },
  });
}

/** Storage stand-in: paths map to bytes; anything else is missing. */
function storage(objects: Record<string, Buffer>) {
  mocks.readImage.mockImplementation(async (path: string) =>
    objects[path] ? { bytes: objects[path], mime: "image/jpeg" } : null,
  );
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.readRecord.mockResolvedValue(null);
  mocks.readImage.mockResolvedValue(null);
  mocks.signUrl.mockResolvedValue(null);
  mocks.storePreview.mockResolvedValue("sessions/x/preview/stored.jpg");
  delete process.env.VERCEL;
});

describe("readPortraitPreview", () => {
  it("compresses the local result once when there is no archive", async () => {
    const session = await finishedSession();
    const first = await readPortraitPreview(session.id);
    expect(await previewInfo(first)).toMatchObject({ format: "jpeg", width: 600 });
    expect(Buffer.compare(await readPortraitPreview(session.id), first)).toBe(0);
    expect(mocks.storePreview).not.toHaveBeenCalled();
  });

  it("shows the new render after a retry overwrites the result", async () => {
    const session = await finishedSession();
    const before = await previewInfo(await readPortraitPreview(session.id));

    await updateSession(session.id, { status: "generating" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await writeResultImage(session.id, await realImage("jpeg", { width: 300, height: 200 }), "image/jpeg");

    const after = await previewInfo(await readPortraitPreview(session.id));
    expect(before.width).toBe(600);
    expect(after).toMatchObject({ width: 300, height: 200 });
  });

  it("keys archived previews by when the result was written", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(archived());
    storage({ "sessions/x/result": generated });

    await readPortraitPreview(session.id);
    const key = `generated-${Date.parse("2026-11-01T04:00:00.000Z").toString(36)}`;
    expect(mocks.readImage).toHaveBeenCalledWith(`sessions/${session.id}/preview/${key}.jpg`, {
      missingOk: true,
    });
    expect(mocks.storePreview).toHaveBeenCalledWith(session.id, key, expect.any(Buffer));
  });

  it("serves the adjustment's stored preview without touching the original", async () => {
    const session = await finishedSession();
    const stored = await realImage("jpeg", { width: 32, height: 32 });
    mocks.readRecord.mockClear();
    mocks.readRecord.mockResolvedValue(withFinal({ size: 30_000_000 }));
    storage({ "sessions/x/preview/final-r1.jpg": stored });

    expect(Buffer.compare(await readPortraitPreview(session.id), stored)).toBe(0);
    expect(mocks.readImage).toHaveBeenCalledTimes(1);
    // One archive read decides both the preview key and the bytes.
    expect(mocks.readRecord).toHaveBeenCalledTimes(1);
  });

  it("rebuilds a missing adjustment preview from that revision's own bytes", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal());
    storage({ "sessions/x/final/r1": adjustedBytes });

    const preview = await readPortraitPreview(session.id);
    expect(await previewInfo(preview)).toMatchObject({ width: 1280, height: 640 });
    expect(mocks.storePreview).toHaveBeenCalledWith(session.id, "final-r1", preview);
  });

  it("never falls back to the replaced image when the adjustment cannot load", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal());

    const error = await readPortraitPreview(session.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).status).toBe(503);
  });

  it("keeps the generated preview separate for the admin's comparison", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal());
    storage({ "sessions/x/result": generated });
    const preview = await readPortraitPreview(session.id, "generated");
    expect((await previewInfo(preview)).width).toBe(600);
  });

  it("409s while painting, unless an admin asks for an archived result", async () => {
    const session = await createSession(imageFile());
    await expect(readPortraitPreview(session.id)).rejects.toMatchObject({ status: 409 });

    mocks.readRecord.mockResolvedValue(archived({ status: "failed" }));
    storage({ "sessions/x/result": generated });
    await expect(readPortraitPreview(session.id)).rejects.toMatchObject({ status: 409 });
    const preview = await readPortraitPreview(session.id, "generated", { allowIncomplete: true });
    expect((await previewInfo(preview)).width).toBe(600);
  });

  it("trusts this instance's finished render when the archive lags behind", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(archived({ status: "generating" }));
    expect((await getSession(session.id)).status).toBe("complete");
    expect((await previewInfo(await readPortraitPreview(session.id))).width).toBe(600);
  });
});

describe("originalDownloadResponse", () => {
  it("streams an original that fits a function response", async () => {
    const session = await finishedSession();
    const response = await originalDownloadResponse(session.id);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(generated);
  });

  it("streams a small adjusted original from its own path", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal());
    storage({ "sessions/x/final/r1": adjustedBytes });

    const response = await originalDownloadResponse(session.id);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Disposition")).toMatch(/portrait\.png"/);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(adjustedBytes);
  });

  it("redirects a big adjusted original to a signed URL without downloading it", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal({ size: FUNCTION_BODY_SAFE_BYTES + 1 }));
    mocks.signUrl.mockResolvedValue("https://storage.googleapis.com/signed");

    const response = await originalDownloadResponse(session.id);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://storage.googleapis.com/signed");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(mocks.signUrl).toHaveBeenCalledWith("sessions/x/final/r1", {
      filename: "zhisheng-bloom-portrait.png",
      mime: "image/png",
    });
    expect(mocks.readImage).not.toHaveBeenCalled();
  });

  it("refuses on Vercel when a big original cannot be signed", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal({ size: FUNCTION_BODY_SAFE_BYTES + 1 }));
    process.env.VERCEL = "1";

    const error = await originalDownloadResponse(session.id).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SessionError);
    expect((error as SessionError).status).toBe(503);
  });

  it("streams it anyway off Vercel, where there is no body cap", async () => {
    const session = await finishedSession();
    mocks.readRecord.mockResolvedValue(withFinal({ size: FUNCTION_BODY_SAFE_BYTES + 1 }));
    storage({ "sessions/x/final/r1": adjustedBytes });

    const response = await originalDownloadResponse(session.id);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(adjustedBytes);
  });
});

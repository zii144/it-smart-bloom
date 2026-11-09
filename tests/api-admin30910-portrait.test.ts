import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "@/app/api/admin30910/roster/[id]/portrait/route";
import { POST as signUpload } from "@/app/api/admin30910/roster/[id]/portrait/upload-url/route";
import { createAdminToken } from "@/lib/admin-auth";
import {
  FinalResultInputError,
  FinalResultUnavailableError,
} from "@/lib/portrait-archive";
import { MAX_ADJUSTED_BYTES } from "@/lib/portrait-limits";
import { RosterNotFoundError } from "@/lib/roster-store";
import { imageFile, jpegBytes, pngBytes, routeContext } from "./helpers";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  readAdjustable: vi.fn(),
  recordAdjusted: vi.fn(),
  recordPortrait: vi.fn(),
  complete: vi.fn(),
  create: vi.fn(),
  unclaimed: vi.fn(),
  store: vi.fn(),
  finalize: vi.fn(),
  clear: vi.fn(),
  target: vi.fn(),
}));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  readRosterPortraitSession: mocks.readSession,
  readRosterAdjustableSession: mocks.readAdjustable,
  recordRosterPortraitAdjusted: mocks.recordAdjusted,
  recordRosterPortrait: mocks.recordPortrait,
}));

vi.mock("@/lib/portrait-archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/portrait-archive")>()),
  storeFinalResult: mocks.store,
  finalizeUploadedFinalResult: mocks.finalize,
  clearFinalResult: mocks.clear,
  createFinalUploadTarget: mocks.target,
  completeSessionWithFinal: mocks.complete,
  createSessionFromFinal: mocks.create,
  unclaimedSessionFromUpload: mocks.unclaimed,
}));

const BASE = "http://booth.local/api/admin30910/roster/abc123/portrait";
const UPLOADED_AT = "2026-11-01T05:00:00.000Z";
const FINAL = {
  path: "sessions/sess-1/final/r1",
  mime: "image/png",
  revisionId: "r1",
  uploadedAt: UPLOADED_AT,
  size: 64,
  previewPath: "sessions/sess-1/preview/final-r1.jpg",
};

function headers({ admin = true, origin }: { admin?: boolean; origin?: string }) {
  const result = new Headers();
  if (admin) result.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (origin) result.set("origin", origin);
  return result;
}

function multipart(options: { admin?: boolean; origin?: string; file?: File | null } = {}) {
  const body = new FormData();
  if (options.file !== null) {
    body.append("image", options.file ?? imageFile(pngBytes(), "image/png", "fixed.png"));
  }
  return new Request(BASE, { method: "POST", headers: headers(options), body });
}

function json(url: string, body: unknown, options: { admin?: boolean; origin?: string } = {}) {
  const h = headers(options);
  h.set("content-type", "application/json");
  return new Request(url, { method: "POST", headers: h, body: JSON.stringify(body) });
}

function remove(options: { admin?: boolean } = {}) {
  return new Request(BASE, { method: "DELETE", headers: headers(options) });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.readSession.mockResolvedValue("sess-1");
  mocks.readAdjustable.mockResolvedValue({ sessionId: "sess-1", failed: false });
  mocks.store.mockResolvedValue(FINAL);
  mocks.finalize.mockResolvedValue(FINAL);
});

describe("POST …/portrait/upload-url", () => {
  it("signs a direct-to-Storage upload for the guest's session", async () => {
    mocks.target.mockResolvedValue({
      uploadUrl: "https://storage.googleapis.com/put",
      objectPath: "sessions/sess-1/uploads/u1",
      headers: { "Content-Type": "image/png", "x-goog-content-length-range": "0,41943040" },
      expiresAt: UPLOADED_AT,
    });
    const response = await signUpload(
      json(`${BASE}/upload-url`, { mime: "image/png", size: 20_000_000 }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "signed",
      uploadUrl: "https://storage.googleapis.com/put",
      objectPath: "sessions/sess-1/uploads/u1",
      headers: { "x-goog-content-length-range": "0,41943040" },
    });
    expect(mocks.target).toHaveBeenCalledWith("sess-1", "image/png");
  });

  it("falls back to a direct upload where URLs cannot be signed", async () => {
    mocks.target.mockResolvedValue(null);
    const response = await signUpload(
      json(`${BASE}/upload-url`, { mime: "image/jpeg", size: 1000 }),
      routeContext("abc123"),
    );
    expect(await response.json()).toEqual({ mode: "direct", maxBytes: 4 * 1024 * 1024 });
  });

  it("rejects bad types and sizes before signing anything", async () => {
    for (const body of [
      { mime: "image/gif", size: 1000 },
      { mime: "image/png", size: 0 },
      { mime: "image/png", size: "big" },
      { mime: "image/png", size: MAX_ADJUSTED_BYTES + 1 },
    ]) {
      const response = await signUpload(json(`${BASE}/upload-url`, body), routeContext("abc123"));
      expect(response.status).toBe(400);
    }
    expect(mocks.target).not.toHaveBeenCalled();
  });

  it("is admin-only, same-origin, and needs a submitted photo", async () => {
    const body = { mime: "image/png", size: 1000 };
    expect(
      (await signUpload(json(`${BASE}/upload-url`, body, { admin: false }), routeContext("abc123")))
        .status,
    ).toBe(401);
    expect(
      (
        await signUpload(
          json(`${BASE}/upload-url`, body, { origin: "https://evil.example" }),
          routeContext("abc123"),
        )
      ).status,
    ).toBe(403);
    mocks.readAdjustable.mockResolvedValue(null);
    expect(
      (await signUpload(json(`${BASE}/upload-url`, body), routeContext("abc123"))).status,
    ).toBe(400);
    expect(mocks.target).not.toHaveBeenCalled();
  });
});

describe("POST …/portrait", () => {
  it("accepts a file already uploaded to Storage", async () => {
    const response = await POST(
      json(BASE, { objectPath: "sessions/sess-1/uploads/u1" }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ portraitAdjustedAt: UPLOADED_AT });
    expect(mocks.finalize).toHaveBeenCalledWith("sess-1", "sessions/sess-1/uploads/u1");
    expect(mocks.recordAdjusted).toHaveBeenCalledWith("abc123", "sess-1", UPLOADED_AT);
  });

  it("reports a rejected Storage upload as 400", async () => {
    mocks.finalize.mockRejectedValue(new FinalResultInputError("上傳的檔案不是有效的圖片。"));
    const response = await POST(
      json(BASE, { objectPath: "sessions/sess-1/uploads/u1" }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(400);
    expect(mocks.recordAdjusted).not.toHaveBeenCalled();
  });

  it("stores a small multipart upload directly", async () => {
    const response = await POST(multipart(), routeContext("abc123"));
    expect(response.status).toBe(200);
    const [sessionId, image] = mocks.store.mock.calls[0];
    expect(sessionId).toBe("sess-1");
    expect(image.mime).toBe("image/png");
    expect(Buffer.compare(image.bytes, pngBytes())).toBe(0);
  });

  it("is admin-only and same-origin", async () => {
    expect((await POST(multipart({ admin: false }), routeContext("abc123"))).status).toBe(401);
    expect(
      (await POST(multipart({ origin: "https://evil.example" }), routeContext("abc123"))).status,
    ).toBe(403);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("refuses a guest whose render is still in progress", async () => {
    mocks.readAdjustable.mockResolvedValue(null);
    const response = await POST(multipart(), routeContext("abc123"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("仍在生成中");
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("makes the upload the portrait of a guest who never sent a photo", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: null, failed: false });
    const response = await POST(multipart(), routeContext("abc123"));
    expect(response.status).toBe(200);
    const sessionId = mocks.store.mock.calls[0][0];
    expect(sessionId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(mocks.create).toHaveBeenCalledWith(sessionId, "abc123", FINAL);
    expect(mocks.recordPortrait).toHaveBeenCalledWith("abc123", sessionId, "complete", {
      isNewSession: true,
    });
    expect(mocks.recordAdjusted).toHaveBeenCalledWith("abc123", sessionId, UPLOADED_AT);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("takes the new session id from a signed upload's path", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: null, failed: false });
    const fresh = "freshSessAbCdEfGh0123456789xyzAB";
    mocks.unclaimed.mockResolvedValue(fresh);
    const objectPath = `sessions/${fresh}/uploads/u1`;
    const response = await POST(json(BASE, { objectPath }), routeContext("abc123"));
    expect(response.status).toBe(200);
    expect(mocks.unclaimed).toHaveBeenCalledWith(objectPath);
    expect(mocks.finalize).toHaveBeenCalledWith(fresh, objectPath);
    expect(mocks.create).toHaveBeenCalledWith(fresh, "abc123", FINAL);
  });

  it("never uses an upload path for a guest who already has a portrait", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: "sess-1", failed: false });
    await POST(json(BASE, { objectPath: "sessions/other/uploads/u1" }), routeContext("abc123"));
    expect(mocks.unclaimed).not.toHaveBeenCalled();
    expect(mocks.finalize).toHaveBeenCalledWith("sess-1", "sessions/other/uploads/u1");
  });

  it("signs uploads under a fresh id for a guest who never sent a photo", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: null, failed: false });
    mocks.target.mockResolvedValue(null);
    const response = await signUpload(
      json(`${BASE}/upload-url`, { mime: "image/jpeg", size: 1000 }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(200);
    expect(mocks.target.mock.calls[0][0]).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("leaves a finished portrait's status alone", async () => {
    await POST(multipart(), routeContext("abc123"));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.recordPortrait).not.toHaveBeenCalled();
  });

  it("completes a failed portrait with the upload instead of a regeneration", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: "sess-1", failed: true });
    const response = await POST(
      json(BASE, { objectPath: "sessions/sess-1/uploads/u1" }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith("sess-1", FINAL);
    expect(mocks.recordPortrait).toHaveBeenCalledWith("abc123", "sess-1", "complete", {
      isNewSession: false,
    });
    expect(mocks.recordAdjusted).toHaveBeenCalledWith("abc123", "sess-1", UPLOADED_AT);
    // Completed first, so the adjustment is recorded on a portrait check-in hands over.
    expect(mocks.recordPortrait.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordAdjusted.mock.invocationCallOrder[0],
    );
  });

  it("signs uploads for a failed portrait too", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: "sess-1", failed: true });
    mocks.target.mockResolvedValue(null);
    const response = await signUpload(
      json(`${BASE}/upload-url`, { mime: "image/jpeg", size: 1000 }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(200);
  });

  it("does not record anything when completing the failed portrait fails", async () => {
    mocks.readAdjustable.mockResolvedValue({ sessionId: "sess-1", failed: true });
    mocks.complete.mockRejectedValue(new FinalResultUnavailableError());
    const response = await POST(multipart(), routeContext("abc123"));
    expect(response.status).toBe(503);
    expect(mocks.recordPortrait).not.toHaveBeenCalled();
    expect(mocks.recordAdjusted).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown or path-like ids", async () => {
    mocks.readAdjustable.mockRejectedValue(new RosterNotFoundError());
    expect((await POST(multipart(), routeContext("missing"))).status).toBe(404);
    expect((await POST(multipart(), routeContext("../x"))).status).toBe(404);
  });

  it("validates a multipart upload like a booth photo", async () => {
    expect((await POST(multipart({ file: null }), routeContext("abc123"))).status).toBe(400);
    const gif = imageFile(jpegBytes(), "image/gif", "x.gif");
    expect((await POST(multipart({ file: gif }), routeContext("abc123"))).status).toBe(415);
    const fake = imageFile(Buffer.from("not an image at all"), "image/png", "x.png");
    expect((await POST(multipart({ file: fake }), routeContext("abc123"))).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });

  it("reports storage trouble as 503 and leaves the roster alone", async () => {
    mocks.store.mockRejectedValue(new FinalResultUnavailableError());
    expect((await POST(multipart(), routeContext("abc123"))).status).toBe(503);
    expect(mocks.recordAdjusted).not.toHaveBeenCalled();
  });
});

describe("DELETE …/portrait", () => {
  it("goes back to the generated portrait", async () => {
    const response = await DELETE(remove(), routeContext("abc123"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ portraitAdjustedAt: null });
    expect(mocks.clear).toHaveBeenCalledWith("sess-1");
    expect(mocks.recordAdjusted).toHaveBeenCalledWith("abc123", "sess-1", null);
  });

  it("is admin-only", async () => {
    expect((await DELETE(remove({ admin: false }), routeContext("abc123"))).status).toBe(401);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
});

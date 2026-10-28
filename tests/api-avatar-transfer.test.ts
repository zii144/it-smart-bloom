import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as mint } from "@/app/api/sessions/[id]/portrait-token/route";
import { POST as mintCheckIn } from "@/app/api/check-in/portrait/[token]/avatar-token/route";
import {
  GET as serve,
  HEAD as inspectLink,
} from "@/app/api/portrait/[token]/route";
import { POST as report } from "@/app/api/sessions/[id]/avatar-result/route";
import { createSession, updateSession, writeResultImage } from "@/lib/sessions";
import { imageFile, jpegBytes, patchMetadata, routeContext } from "./helpers";

const mocks = vi.hoisted(() => ({
  mint: vi.fn(),
  redeem: vi.fn(),
  find: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/lib/portrait-token", async (original) => ({
  ...(await original<typeof import("@/lib/portrait-token")>()),
  mintPortraitTicket: mocks.mint,
  redeemPortraitTicket: mocks.redeem,
}));
vi.mock("@/lib/roster-store", async (original) => ({
  ...(await original<typeof import("@/lib/roster-store")>()),
  findPortraitByAccessToken: mocks.find,
}));
vi.mock("@/lib/portrait-archive", async (original) => ({
  ...(await original<typeof import("@/lib/portrait-archive")>()),
  markAvatarRequest: mocks.report,
}));
const request = () =>
  new Request("https://bloom.example/api/sessions/test/portrait-token", {
    method: "POST",
  });
const tokenContext = (token = "t".repeat(43)) => ({
  params: Promise.resolve({ token }),
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "true";
  vi.clearAllMocks();
  mocks.mint.mockResolvedValue({
    token: "t".repeat(43),
    expiresAt: "2026-11-10T01:05:00.000Z",
  });
  process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY = "public-key";
  process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN = "rt-test.firebaseapp.com";
  process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID = "rt-test";
  process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL =
    "https://rt.example/bloomSetAvatar";
});
async function finished() {
  const session = await createSession(imageFile());
  await writeResultImage(session.id, jpegBytes(), "image/jpeg");
  return session;
}

describe("portrait capability routes", () => {
  it("does not issue transfer tickets while the feature is hidden", async () => {
    const session = await finished();
    process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "false";
    expect((await mint(request(), routeContext(session.id))).status).toBe(404);
    expect(mocks.mint).not.toHaveBeenCalled();
  });
  it("mints an absolute HTTPS URL only for a completed, unexpired session", async () => {
    const session = await finished();
    const response = await mint(request(), routeContext(session.id));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).url).toBe(
      `https://bloom.example/api/portrait/${"t".repeat(43)}`,
    );
    expect(mocks.mint).toHaveBeenCalledWith(session.id);
  });
  it("does not issue a capability for an incomplete or expired session", async () => {
    const session = await createSession(imageFile());
    expect((await mint(request(), routeContext(session.id))).status).toBe(409);
    await updateSession(session.id, {
      status: "complete",
      resultMime: "image/jpeg",
    });
    await patchMetadata(session.id, { expiresAt: new Date(0).toISOString() });
    expect((await mint(request(), routeContext(session.id))).status).toBe(410);
    expect(mocks.mint).not.toHaveBeenCalled();
  });
  it("fails closed when production config is missing or the public origin is HTTP", async () => {
    const session = await finished();
    process.env.APP_BASE_URL = "http://bloom.example";
    expect((await mint(request(), routeContext(session.id))).status).toBe(503);
    delete process.env.APP_BASE_URL;
    delete process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY;
    expect((await mint(request(), routeContext(session.id))).status).toBe(503);
    expect(mocks.mint).not.toHaveBeenCalled();
  });
  it("uses the valid check-in token even after the creation link expires", async () => {
    const session = await finished();
    await patchMetadata(session.id, { expiresAt: new Date(0).toISOString() });
    mocks.find.mockResolvedValueOnce({
      sessionId: session.id,
      name: "測試來賓",
    });
    expect((await mintCheckIn(request(), tokenContext())).status).toBe(200);
    expect(mocks.mint).toHaveBeenCalledWith(session.id);
    mocks.find.mockResolvedValueOnce(null);
    expect((await mintCheckIn(request(), tokenContext())).status).toBe(404);
    expect(mocks.mint).toHaveBeenCalledTimes(1);
  });
  it("redeems before serving only finished image bytes, without credentials or identity", async () => {
    const session = await finished();
    mocks.redeem.mockResolvedValueOnce(session.id);
    const response = await serve(request(), tokenContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(jpegBytes());
  });
  it("does not consume a ticket for a link-checker HEAD request", () => {
    expect(inspectLink().status).toBe(405);
    expect(mocks.redeem).not.toHaveBeenCalled();
  });
});

describe("advisory avatar outcome", () => {
  it("validates the session, ignores arbitrary error text and stores no RT identifier", async () => {
    const session = await finished();
    const response = await report(
      new Request("https://bloom.example", {
        method: "POST",
        body: JSON.stringify({
          ok: false,
          error: "token=secret",
          uid: "other-user",
        }),
      }),
      routeContext(session.id),
    );
    expect(response.status).toBe(200);
    expect(mocks.report).toHaveBeenCalledWith(session.id, {
      ok: false,
      error: "用戶端回報替換未完成。",
    });
  });
  it("rejects malformed results without changing the archive", async () => {
    const session = await finished();
    const response = await report(
      new Request("https://bloom.example", {
        method: "POST",
        body: JSON.stringify({ ok: "yes" }),
      }),
      routeContext(session.id),
    );
    expect(response.status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });
});

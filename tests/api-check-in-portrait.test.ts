import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/check-in/portrait/[token]/route";
import { RosterUnavailableError } from "@/lib/roster-store";
import { createSession, updateSession, writeResultImage } from "@/lib/sessions";
import { imageFile, jpegBytes } from "./helpers";

const { findPortraitMock } = vi.hoisted(() => ({ findPortraitMock: vi.fn() }));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  findPortraitByAccessToken: findPortraitMock,
}));

function get(token: string, query = "") {
  return GET(new Request(`http://booth.local/api/check-in/portrait/${token}${query}`), {
    params: Promise.resolve({ token }),
  });
}

async function finishedSession() {
  const session = await createSession(imageFile());
  await writeResultImage(session.id, jpegBytes(), "image/jpeg");
  await updateSession(session.id, { status: "complete", resultMime: "image/jpeg" });
  return session;
}

beforeEach(() => {
  findPortraitMock.mockReset();
});

describe("GET /api/check-in/portrait/:token", () => {
  it("serves the guest's finished portrait", async () => {
    const session = await finishedSession();
    findPortraitMock.mockResolvedValue({ sessionId: session.id, name: "王小美" });

    const response = await get("tok");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/^inline/);
    expect(findPortraitMock).toHaveBeenCalledWith("tok");
  });

  it("offers it as a download", async () => {
    const session = await finishedSession();
    findPortraitMock.mockResolvedValue({ sessionId: session.id, name: "王小美" });

    const response = await get("tok", "?download=1");

    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="zhisheng-bloom-portrait\.jpg"/);
  });

  it("keeps working after the 15-minute session link has expired", async () => {
    const session = await finishedSession();
    findPortraitMock.mockResolvedValue({ sessionId: session.id, name: "王小美" });

    vi.useFakeTimers({ now: Date.parse(session.expiresAt) + 60 * 60 * 1000, toFake: ["Date"] });
    try {
      expect((await get("tok")).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unknown or expired tokens", async () => {
    findPortraitMock.mockResolvedValue(null);
    const response = await get("nope");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("重新報到");
  });

  it("reports Firestore being unavailable as 503", async () => {
    findPortraitMock.mockRejectedValue(new RosterUnavailableError());
    expect((await get("tok")).status).toBe(503);
  });
});

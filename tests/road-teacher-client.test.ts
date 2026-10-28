import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replaceRoadTeacherAvatar } from "@/lib/road-teacher-client";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  forget: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("@/lib/road-teacher-auth", async (original) => ({
  ...(await original<typeof import("@/lib/road-teacher-auth")>()),
  signInToRoadTeacher: mocks.signIn,
  forgetRoadTeacherSession: mocks.forget,
}));
const ENDPOINT =
  "https://us-central1-rt-test.cloudfunctions.net/bloomSetAvatar";
const PORTRAIT = "https://bloom.example/api/portrait/" + "a".repeat(43);
const credentials = {
  email: "guest@example.com",
  password: "never-send-to-bloom",
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "true";
  vi.clearAllMocks();
  mocks.signIn.mockResolvedValue("private-rt-token");
  mocks.forget.mockResolvedValue(undefined);
  process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY = "public-key";
  process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN = "rt-test.firebaseapp.com";
  process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID = "rt-test";
  process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL = ENDPOINT;
  mocks.fetch.mockImplementation(async (url: string) =>
    url === ENDPOINT
      ? Response.json({ ok: true })
      : url.endsWith("avatar-result")
        ? Response.json({ ok: true })
        : Response.json({ url: PORTRAIT }),
  );
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("RT portrait transfer", () => {
  it("does not start login or a transfer while the feature is hidden", async () => {
    process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "false";
    await expect(
      replaceRoadTeacherAvatar({ ...credentials, sessionId: "a".repeat(32) }),
    ).rejects.toThrow("尚未開通");
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("times out a stuck mobile request and signs out so the guest can retry", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const failure = expect(
      replaceRoadTeacherAvatar({
        ...credentials,
        checkInToken: "b".repeat(43),
      }),
    ).rejects.toThrow("網路連線不穩");
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(mocks.forget).toHaveBeenCalledTimes(1);
  });
  it("sends only the short-lived portrait URL to RT, keeping credentials out of Bloom requests", async () => {
    await expect(
      replaceRoadTeacherAvatar({ ...credentials, sessionId: "a".repeat(32) }),
    ).resolves.toEqual({ mock: false });
    const calls = mocks.fetch.mock.calls as [string, RequestInit][];
    const remote = calls.find(([url]) => url === ENDPOINT)!;
    expect(remote[1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
      headers: { Authorization: "Bearer private-rt-token" },
    });
    expect(JSON.parse(String(remote[1].body))).toEqual({
      portraitUrl: PORTRAIT,
      sessionId: "a".repeat(32),
    });
    expect(
      JSON.stringify(calls.filter(([url]) => url !== ENDPOINT)),
    ).not.toMatch(/private-rt-token|never-send-to-bloom|guest@example/);
    expect(mocks.forget).toHaveBeenCalledTimes(1);
  });

  it("mints via the check-in capability without exposing a session ID", async () => {
    await replaceRoadTeacherAvatar({
      ...credentials,
      checkInToken: "b".repeat(43),
    });
    expect(mocks.fetch.mock.calls[0]?.[0]).toBe(
      `/api/check-in/portrait/${"b".repeat(43)}/avatar-token`,
    );
    const remote = mocks.fetch.mock.calls.find(([url]) => url === ENDPOINT)!;
    expect(JSON.parse(String(remote[1].body))).toEqual({
      portraitUrl: PORTRAIT,
      sessionId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
  });

  it("does not mint or transfer on login failure and still signs out", async () => {
    mocks.signIn.mockRejectedValueOnce({ code: "auth/invalid-credential" });
    await expect(
      replaceRoadTeacherAvatar({ ...credentials, sessionId: "a".repeat(32) }),
    ).rejects.toMatchObject({ code: "auth/invalid-credential" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.forget).toHaveBeenCalled();
  });

  it.each(["ticket", "network", "invalid-success", "mock-success"])(
    "never reports success on %s failure, and signs out",
    async (stage) => {
      mocks.fetch.mockImplementation(async (url: string) => {
        if (url.endsWith("avatar-result")) return Response.json({ ok: true });
        if (url !== ENDPOINT)
          return stage === "ticket"
            ? Response.json({ error: "圖片連結已失效。" }, { status: 410 })
            : Response.json({ url: PORTRAIT });
        if (stage === "network") throw new Error("network down");
        return Response.json(
          stage === "mock-success" ? { ok: true, mock: true } : {},
        );
      });
      await expect(
        replaceRoadTeacherAvatar({ ...credentials, sessionId: "a".repeat(32) }),
      ).rejects.toThrow();
      const report = mocks.fetch.mock.calls.find(([url]) =>
        url.endsWith("avatar-result"),
      )!;
      expect(JSON.parse(String(report[1].body)).ok).toBe(false);
      expect(mocks.forget).toHaveBeenCalledTimes(1);
    },
  );
});

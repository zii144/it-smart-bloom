import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RoadTeacherAvatarError,
  isRoadTeacherAvatarMockEnabled,
  requestRoadTeacherAvatar,
} from "@/lib/road-teacher-avatar";

const ENDPOINT = "https://rt.example/bloomSetAvatarByIdentity";
const INPUT = {
  sessionId: "session-1",
  name: "張小明",
  mobile: "0912345678",
  imageBytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  imageMime: "image/jpeg",
};

function stubFetch(status: number, body: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.ROAD_TEACHER_AVATAR_API_URL = ENDPOINT;
  process.env.ROAD_TEACHER_AVATAR_API_KEY = "shared-key";
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requestRoadTeacherAvatar", () => {
  it("posts the name, mobile and portrait with the shared key", async () => {
    const fetchMock = stubFetch(200, { ok: true });

    await expect(requestRoadTeacherAvatar(INPUT)).resolves.toEqual({
      mock: false,
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer shared-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(init.body))).toEqual({
      name: "張小明",
      mobile: "0912345678",
      sessionId: "session-1",
      image: INPUT.imageBytes.toString("base64"),
      imageMime: "image/jpeg",
    });
  });

  it.each([
    ["teacher_not_found", 404, 404, /找不到符合/],
    ["ambiguous_teacher", 409, 409, /多位路老師/],
    ["rate_limited", 429, 429, /一小時後/],
    ["account_disabled", 403, 403, /停用/],
  ])(
    "maps road-teacher's %s to a guest message",
    async (code, rtStatus, status, message) => {
      stubFetch(rtStatus, { error: "x", code });
      const error = await requestRoadTeacherAvatar(INPUT).catch((e) => e);
      expect(error).toBeInstanceOf(RoadTeacherAvatarError);
      expect(error).toMatchObject({ status, code });
      expect(error.message).toMatch(message);
    },
  );

  it("treats integration faults as a generic 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubFetch(401, { error: "Unauthorized", code: "unauthorized" });
    await expect(requestRoadTeacherAvatar(INPUT)).rejects.toMatchObject({
      status: 502,
      code: "unauthorized",
    });
  });

  it("reports an unreachable road-teacher as 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(requestRoadTeacherAvatar(INPUT)).rejects.toMatchObject({
      status: 502,
      code: "unreachable",
    });
  });

  it("refuses to call road-teacher without a URL and key", async () => {
    const fetchMock = stubFetch(200);
    delete process.env.ROAD_TEACHER_AVATAR_API_KEY;
    await expect(requestRoadTeacherAvatar(INPUT)).rejects.toMatchObject({
      status: 503,
      code: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mock mode", () => {
  it("never activates in a production build, even with the flag set", () => {
    process.env.NEXT_PUBLIC_RT_MOCK = "true";
    expect(isRoadTeacherAvatarMockEnabled()).toBe(false);
  });

  it("skips the network call in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.NEXT_PUBLIC_RT_MOCK = "true";
    const fetchMock = stubFetch(500);

    await expect(requestRoadTeacherAvatar(INPUT)).resolves.toEqual({
      mock: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

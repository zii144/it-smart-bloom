import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postClaim } from "@/app/api/sessions/[id]/claim/route";
import { POST as postAvatar } from "@/app/api/sessions/[id]/avatar/route";
import {
  createSession,
  getSession,
  writeResultImage,
} from "@/lib/sessions";
import { imageFile, jpegBytes, routeContext } from "./helpers";

const { requestAvatarMock, markAvatarRequestMock } = vi.hoisted(() => ({
  requestAvatarMock: vi.fn(),
  markAvatarRequestMock: vi.fn(async () => undefined),
}));

vi.mock("@/lib/road-teacher-avatar", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/road-teacher-avatar")>();
  return {
    RoadTeacherAvatarError: actual.RoadTeacherAvatarError,
    requestRoadTeacherAvatar: requestAvatarMock,
  };
});

vi.mock("@/lib/portrait-archive", () => ({
  claimSessionIdentity: vi.fn(async () => ({
    identityKey: "mobile_0912345678",
    claimedAt: new Date().toISOString(),
  })),
  markAvatarRequest: markAvatarRequestMock,
}));

const IDENTITY = { name: "張小明", mobile: "0912345678" };

function claim(sessionId: string, body: unknown) {
  return postClaim(
    new Request("http://phone.local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    routeContext(sessionId),
  );
}

function requestAvatar(sessionId: string) {
  return postAvatar(
    new Request("http://phone.local", { method: "POST" }),
    routeContext(sessionId),
  );
}

async function completedSessionWithIdentity() {
  const session = await createSession(imageFile());
  await writeResultImage(session.id, jpegBytes(), "image/jpeg");
  await claim(session.id, IDENTITY);
  return session;
}

beforeEach(() => {
  requestAvatarMock.mockReset();
  requestAvatarMock.mockResolvedValue({ mock: false });
  markAvatarRequestMock.mockClear();
});

describe("POST /api/sessions/[id]/claim", () => {
  it("stores the name and mobile but never returns them", async () => {
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    const response = await claim(session.id, {
      name: " 張小明 ",
      mobile: "0912-345-678",
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text).identityClaimed).toBe(true);
    expect(text).not.toContain("0912345678");
    expect(text).not.toContain("張小明");
    expect((await getSession(session.id)).identity).toMatchObject(IDENTITY);
  });

  it("rejects a claim without a mobile", async () => {
    const session = await createSession(imageFile());
    const response = await claim(session.id, { name: "張小明" });
    expect(response.status).toBe(400);
  });

  it("no longer accepts a LINE ID", async () => {
    const session = await createSession(imageFile());
    const response = await claim(session.id, { lineId: "112-張小明-南投縣" });
    expect(response.status).toBe(400);
  });
});

describe("POST /api/sessions/[id]/avatar", () => {
  it("requires a stored identity before calling road-teacher", async () => {
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    const response = await requestAvatar(session.id);

    expect(response.status).toBe(400);
    expect(requestAvatarMock).not.toHaveBeenCalled();
  });

  it("forwards the portrait with the stored name and mobile", async () => {
    const session = await completedSessionWithIdentity();

    const response = await requestAvatar(session.id);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ avatarRequested: true, mock: false });
    expect(requestAvatarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        name: "張小明",
        mobile: "0912345678",
        imageMime: "image/jpeg",
      }),
    );
    expect(markAvatarRequestMock).toHaveBeenCalledWith(session.id, {
      ok: true,
    });
  });

  it("passes road-teacher's guest-facing error through", async () => {
    const { RoadTeacherAvatarError } = await import("@/lib/road-teacher-avatar");
    requestAvatarMock.mockRejectedValue(
      new RoadTeacherAvatarError("找不到符合的路老師", 404, "teacher_not_found"),
    );
    const session = await completedSessionWithIdentity();

    const response = await requestAvatar(session.id);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "找不到符合的路老師",
      code: "teacher_not_found",
    });
    expect(markAvatarRequestMock).toHaveBeenCalledWith(session.id, {
      ok: false,
      error: "teacher_not_found",
    });
  });

  it("does not record a mock run as a real success", async () => {
    requestAvatarMock.mockResolvedValue({ mock: true });
    const session = await completedSessionWithIdentity();

    const response = await requestAvatar(session.id);

    expect(response.status).toBe(200);
    expect((await response.json()).mock).toBe(true);
    expect(markAvatarRequestMock).not.toHaveBeenCalled();
  });

  it("waits for the portrait to finish", async () => {
    const session = await createSession(imageFile());
    await claim(session.id, IDENTITY);

    const response = await requestAvatar(session.id);

    expect(response.status).toBe(409);
    expect(requestAvatarMock).not.toHaveBeenCalled();
  });
});

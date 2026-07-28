import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postClaim } from "@/app/api/sessions/[id]/claim/route";
import { POST as postAvatar } from "@/app/api/sessions/[id]/avatar/route";
import {
  createSession,
  getSession,
  writeResultImage,
} from "@/lib/sessions";
import { imageFile, jpegBytes, routeContext } from "./helpers";

const { requestAvatarMock } = vi.hoisted(() => ({
  requestAvatarMock: vi.fn(),
}));

vi.mock("@/lib/road-teacher-avatar", () => ({
  requestRoadTeacherAvatar: requestAvatarMock,
}));

vi.mock("@/lib/portrait-archive", () => ({
  claimSessionIdentity: vi.fn(async () => ({
    identityKey: "lineId_112-張小明-南投縣",
    claimedAt: new Date().toISOString(),
  })),
  markAvatarRequest: vi.fn(async () => undefined),
}));

beforeEach(() => {
  requestAvatarMock.mockReset();
  requestAvatarMock.mockResolvedValue({ ok: true });
});

describe("POST /api/sessions/[id]/claim", () => {
  it("stores exactly one identity on the session", async () => {
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    const response = await postClaim(
      new Request("http://phone.local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId: "112-張小明-南投縣" }),
      }),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.identity).toMatchObject({
      kind: "lineId",
      value: "112-張小明-南投縣",
    });
    expect((await getSession(session.id)).identity?.value).toBe(
      "112-張小明-南投縣",
    );
  });

  it("rejects filling both fields", async () => {
    const session = await createSession(imageFile());
    const response = await postClaim(
      new Request("http://phone.local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineId: "112-張小明-南投縣",
          mobile: "0912345678",
        }),
      }),
      routeContext(session.id),
    );

    expect(response.status).toBe(400);
  });
});

describe("POST /api/sessions/[id]/avatar", () => {
  it("requires a claimed identity before calling road-teacher", async () => {
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    const response = await postAvatar(
      new Request("http://phone.local", { method: "POST" }),
      routeContext(session.id),
    );

    expect(response.status).toBe(400);
    expect(requestAvatarMock).not.toHaveBeenCalled();
  });

  it("forwards the portrait once identity is claimed", async () => {
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");
    await postClaim(
      new Request("http://phone.local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile: "0912345678" }),
      }),
      routeContext(session.id),
    );

    const response = await postAvatar(
      new Request("http://phone.local", { method: "POST" }),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(requestAvatarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        identityKind: "mobile",
        identityValue: "0912345678",
      }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin30910/submissions/route";
import { createAdminToken } from "@/lib/admin-auth";
import { RosterUnavailableError } from "@/lib/roster-store";

const store = vi.hoisted(() => ({
  readPhotoSubmissionSettings: vi.fn(),
  setPhotoSubmissionsOpen: vi.fn(),
}));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  ...store,
}));

const URL = "http://booth.local/api/admin30910/submissions";

function request(
  method: "GET" | "POST",
  body?: unknown,
  { admin = true, origin }: { admin?: boolean; origin?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (admin) headers.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (origin) headers.set("origin", origin);
  return new Request(URL, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  for (const mock of Object.values(store)) mock.mockReset();
  store.readPhotoSubmissionSettings.mockResolvedValue({ open: true, updatedAt: null });
  store.setPhotoSubmissionsOpen.mockImplementation(async (open: boolean) => ({
    open,
    updatedAt: "2026-11-01T05:00:00.000Z",
  }));
});

describe("GET /api/admin30910/submissions", () => {
  it("reports the current state", async () => {
    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      submissions: { open: true, updatedAt: null },
    });
  });

  it("is admin-only", async () => {
    expect((await GET(request("GET", undefined, { admin: false }))).status).toBe(401);
    expect(store.readPhotoSubmissionSettings).not.toHaveBeenCalled();
  });

  it("reports Firebase being unavailable as 503", async () => {
    store.readPhotoSubmissionSettings.mockRejectedValue(new RosterUnavailableError());
    expect((await GET(request("GET"))).status).toBe(503);
  });
});

describe("POST /api/admin30910/submissions", () => {
  it("closes and reopens submissions", async () => {
    const closed = await POST(request("POST", { open: false }));
    expect(closed.status).toBe(200);
    expect((await closed.json()).submissions.open).toBe(false);

    await POST(request("POST", { open: true }));
    expect(store.setPhotoSubmissionsOpen).toHaveBeenLastCalledWith(true);
  });

  it("requires an explicit boolean", async () => {
    expect((await POST(request("POST", { open: "no" }))).status).toBe(400);
    expect(store.setPhotoSubmissionsOpen).not.toHaveBeenCalled();
  });

  it("is admin-only and same-origin", async () => {
    expect((await POST(request("POST", { open: false }, { admin: false }))).status).toBe(401);
    expect(
      (await POST(request("POST", { open: false }, { origin: "https://evil.example" }))).status,
    ).toBe(403);
    expect(store.setPhotoSubmissionsOpen).not.toHaveBeenCalled();
  });
});

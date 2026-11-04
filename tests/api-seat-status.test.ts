import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/seat-status/access/route";
import { GET } from "@/app/api/seat-status/route";
import { POST as rebuild } from "@/app/api/admin30910/seat-status/rebuild/route";
import { createAdminToken } from "@/lib/admin-auth";
import { createDisplaySession, DISPLAY_COOKIE, verifyDisplaySession } from "@/lib/seat-status-auth";

const mocks = vi.hoisted(() => ({ ensureSeatStatusReady: vi.fn(), readSeatStatus: vi.fn(), rebuildSeatStatus: vi.fn(), createCustomToken: vi.fn() }));
vi.mock("@/lib/seat-status-store", () => mocks);
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ createCustomToken: mocks.createCustomToken }) }));
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseApp: () => ({ options: { projectId: "test-project" } }) }));

function request(path = "/api/seat-status/access", options: { cookie?: string; key?: string; origin?: string; method?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.origin) headers.set("origin", options.origin);
  return new Request(`http://booth.local${path}`, {
    method: options.method ?? "POST", headers,
    ...(options.method !== "GET" ? { body: JSON.stringify({ key: options.key }) } : {}),
  });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "display-test";
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.createCustomToken.mockResolvedValue("scoped-firebase-token");
  mocks.readSeatStatus.mockResolvedValue({ entries: [], checkIn: { open: false, updatedAt: null }, verifiedAt: "now" });
});

it("requires staff authentication before bootstrap or snapshot reads", async () => {
  expect((await POST(request())).status).toBe(401);
  expect((await POST(request(undefined, { key: "wrong" }))).status).toBe(401);
  expect((await GET(request("/api/seat-status", { method: "GET" }))).status).toBe(401);
  expect(mocks.ensureSeatStatusReady).not.toHaveBeenCalled();
  expect(mocks.readSeatStatus).not.toHaveBeenCalled();
});

it("issues a display-only cookie and a Firebase token with a fixed expiry", async () => {
  const response = await POST(request(undefined, { key: "display-test" }));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain(`${DISPLAY_COOKIE}=`);
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Path=/api/seat-status");
  expect(cookie).not.toContain("bloom_admin=");
  const token = cookie.split(";")[0].split("=")[1];
  const session = verifyDisplaySession(decodeURIComponent(token))!;
  expect(mocks.createCustomToken).toHaveBeenCalledWith(`seat-display-${session.id}`, {
    seatStatusDisplay: true, seatStatusExpiresAt: session.expiresAt,
  });
  expect((await response.json()).expiresAt).toBe(session.expiresAt);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

it("refreshing access never extends the screen's authorization", async () => {
  const session = createDisplaySession(Date.now() - 60_000);
  const cookie = `${DISPLAY_COOKIE}=${session.token}`;
  const response = await POST(request(undefined, { cookie }));
  expect((await response.json()).expiresAt).toBe(session.expiresAt);
  expect(response.headers.get("set-cookie")).toBeNull();
  expect((await GET(request("/api/seat-status", { method: "GET", cookie }))).status).toBe(200);
  // A display session cannot authorize rebuilding, let alone editing the roster.
  expect((await rebuild(request("/api/admin30910/seat-status/rebuild", { cookie }))).status).toBe(401);
});

it("accepts an existing admin session and blocks cross-origin enrollment", async () => {
  const cookie = `bloom_admin=${createAdminToken()}`;
  expect((await POST(request(undefined, { cookie }))).status).toBe(200);
  expect((await POST(request(undefined, { cookie, origin: "https://evil.example" }))).status).toBe(403);
});

it("keeps polling available when Firebase token signing is unavailable", async () => {
  mocks.createCustomToken.mockRejectedValue(new Error("signing unavailable"));
  const response = await POST(request(undefined, { key: "display-test" }));
  expect(response.status).toBe(200);
  expect((await response.json()).customToken).toBeNull();
});

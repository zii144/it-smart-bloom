import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/seat-status/guests/route";
import { createAdminToken } from "@/lib/admin-auth";
import { createDisplaySession, DISPLAY_COOKIE } from "@/lib/seat-status-auth";

const mocks = vi.hoisted(() => ({ readSeatGuests: vi.fn() }));
vi.mock("@/lib/seat-guest-store", () => mocks);
function request(query = "seat=A1&ids=guest-1", cookie?: string) {
  return new Request(`http://localhost/api/seat-status/guests?${query}`, { headers: cookie ? { cookie } : {} });
}
function displayCookie() { return `${DISPLAY_COOKIE}=${createDisplaySession().token}`; }
beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "guest-test";
  mocks.readSeatGuests.mockReset().mockResolvedValue([]);
});

it("requires an unexpired display or admin session before reading names", async () => {
  expect((await GET(request())).status).toBe(401);
  const expired = createDisplaySession(Date.now() - 13 * 60 * 60 * 1000);
  expect((await GET(request(undefined, `${DISPLAY_COOKIE}=${expired.token}`))).status).toBe(401);
  expect(mocks.readSeatGuests).not.toHaveBeenCalled();
  expect((await GET(request(undefined, displayCookie()))).status).toBe(200);
  expect((await GET(request(undefined, `bloom_admin=${createAdminToken()}`))).status).toBe(200);
});

it("normalizes seat labels, deduplicates IDs and prevents caching guest information", async () => {
  const guest = { id: "guest-1", name: "測試來賓", role: "路老師", seat: "A1", checkedInAt: null };
  mocks.readSeatGuests.mockResolvedValue([guest]);
  const response = await GET(request("seat=%EF%BD%81%EF%BC%91&ids=guest-1,guest-1", displayCookie()));
  expect(mocks.readSeatGuests).toHaveBeenCalledWith("A1", ["guest-1"]);
  expect(await response.json()).toEqual({ guests: [guest] });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it.each(["seat=A1", "ids=guest-1", "seat=A1&ids=../private", "seat=A1&ids=a/b", `seat=A1&ids=${Array.from({ length: 101 }, (_, i) => `guest-${i}`).join(",")}`])("rejects invalid or excessive lookups: %s", async (query) => {
  expect((await GET(request(query, displayCookie()))).status).toBe(400);
  expect(mocks.readSeatGuests).not.toHaveBeenCalled();
});

it("returns a retryable error without exposing backend details", async () => {
  mocks.readSeatGuests.mockRejectedValue(new Error("private database details"));
  const response = await GET(request(undefined, displayCookie()));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private database details");
});

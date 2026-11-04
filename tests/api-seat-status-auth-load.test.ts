import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/seat-status/access/route";

vi.mock("firebase-admin/auth", () => { throw new Error("ERR_REQUIRE_ESM: simulated Auth module failure"); });
vi.mock("@/lib/firebase-admin", () => ({ getFirebaseApp: () => ({ options: { projectId: "test-project" } }) }));
vi.mock("@/lib/seat-status-store", () => ({ ensureSeatStatusReady: vi.fn() }));

beforeEach(() => { process.env.ADMIN_DASHBOARD_SECRET = "runtime-test"; });

it("still validates passwords when the optional Auth module cannot load", async () => {
  const response = await POST(new Request("https://display.local/api/seat-status/access", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "wrong" }),
  }));
  expect(response.status).toBe(401);
});

it("authorizes polling even if importing the optional Auth module fails", async () => {
  const response = await POST(new Request("https://display.local/api/seat-status/access", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "runtime-test" }),
  }));
  expect(response.status).toBe(200);
  expect((await response.json()).customToken).toBeNull();
  expect(response.headers.get("set-cookie")).toContain("bloom_seat_display=");
});

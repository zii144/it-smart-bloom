import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as toggleCheckIn } from "@/app/api/admin30910/check-in/route";
import { POST as setGuestCheckIn } from "@/app/api/admin30910/roster/[id]/check-in/route";
import { createAdminToken } from "@/lib/admin-auth";
import { RosterNotFoundError } from "@/lib/roster-store";
import { routeContext } from "./helpers";

const store = vi.hoisted(() => ({
  setCheckInOpen: vi.fn(),
  checkInRosterEntry: vi.fn(),
  undoRosterCheckIn: vi.fn(),
}));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  ...store,
}));

function request(url: string, body: unknown, { admin = true, origin }: { admin?: boolean; origin?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (admin) headers.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (origin) headers.set("origin", origin);
  return new Request(url, { method: "POST", headers, body: JSON.stringify(body) });
}

const TOGGLE = "http://booth.local/api/admin30910/check-in";
const GUEST = "http://booth.local/api/admin30910/roster/abc123/check-in";

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  for (const mock of Object.values(store)) mock.mockReset();
  store.setCheckInOpen.mockImplementation(async (open: boolean) => ({
    open,
    updatedAt: "2026-11-10T05:00:00.000Z",
  }));
});

describe("POST /api/admin30910/check-in", () => {
  it("opens and closes check-in", async () => {
    const opened = await toggleCheckIn(request(TOGGLE, { open: true }));
    expect(opened.status).toBe(200);
    expect((await opened.json()).checkIn.open).toBe(true);

    await toggleCheckIn(request(TOGGLE, { open: false }));
    expect(store.setCheckInOpen).toHaveBeenLastCalledWith(false);
  });

  it("requires an explicit boolean", async () => {
    expect((await toggleCheckIn(request(TOGGLE, { open: "yes" }))).status).toBe(400);
    expect(store.setCheckInOpen).not.toHaveBeenCalled();
  });

  it("is admin-only and same-origin", async () => {
    expect((await toggleCheckIn(request(TOGGLE, { open: true }, { admin: false }))).status).toBe(401);
    expect(
      (await toggleCheckIn(request(TOGGLE, { open: true }, { origin: "https://evil.example" })))
        .status,
    ).toBe(403);
    expect(store.setCheckInOpen).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin30910/roster/:id/check-in", () => {
  it("lets staff check a guest in", async () => {
    store.checkInRosterEntry.mockResolvedValue({
      name: "王小美",
      seat: "A1",
      checkedInAt: "2026-11-10T06:00:00.000Z",
      alreadyCheckedIn: false,
      portrait: { status: "complete", accessToken: "guest-only" },
    });

    const response = await setGuestCheckIn(request(GUEST, { checkedIn: true }), routeContext("abc123"));

    expect(response.status).toBe(200);
    expect(store.checkInRosterEntry).toHaveBeenCalledWith("abc123", "admin");
    // The portrait link belongs to the guest; staff never receive it.
    expect(JSON.stringify(await response.json())).not.toContain("guest-only");
  });

  it("lets staff undo a mistaken check-in", async () => {
    const response = await setGuestCheckIn(request(GUEST, { checkedIn: false }), routeContext("abc123"));

    expect(response.status).toBe(200);
    expect(store.undoRosterCheckIn).toHaveBeenCalledWith("abc123");
  });

  it("returns 404 for unknown or path-like ids", async () => {
    store.checkInRosterEntry.mockRejectedValue(new RosterNotFoundError());
    expect(
      (await setGuestCheckIn(request(GUEST, { checkedIn: true }), routeContext("missing"))).status,
    ).toBe(404);
    expect(
      (await setGuestCheckIn(request(GUEST, { checkedIn: true }), routeContext("../x"))).status,
    ).toBe(404);
  });

  it("requires admin", async () => {
    const response = await setGuestCheckIn(
      request(GUEST, { checkedIn: true }, { admin: false }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(401);
    expect(store.checkInRosterEntry).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/check-in/route";
import { RosterNotFoundError, RosterUnavailableError } from "@/lib/roster-store";

const store = vi.hoisted(() => ({
  findRosterMatch: vi.fn(),
  readCheckInSettings: vi.fn(),
  checkInRosterEntry: vi.fn(),
}));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  ...store,
}));

function checkIn(body: unknown) {
  return POST(
    new Request("http://booth.local/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify(body),
    }),
  );
}

const GUEST = { name: "王小美", phone: "0911-111-111" };

beforeEach(() => {
  for (const mock of Object.values(store)) mock.mockReset();
  store.readCheckInSettings.mockResolvedValue({ open: true, updatedAt: null });
  store.findRosterMatch.mockResolvedValue({ id: "roster-1" });
  store.checkInRosterEntry.mockResolvedValue({
    name: "王小美",
    seat: "A1",
    checkedInAt: "2026-11-10T06:02:00.000Z",
    alreadyCheckedIn: false,
    portrait: { status: null, accessToken: null },
  });
});

describe("POST /api/check-in", () => {
  it("checks a roster guest in and returns only their own name, seat and time", async () => {
    const response = await checkIn(GUEST);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: "王小美",
      seat: "A1",
      checkedInAt: "2026-11-10T06:02:00.000Z",
      alreadyCheckedIn: false,
      portrait: { status: null, url: null },
    });
    expect(store.findRosterMatch).toHaveBeenCalledWith("王小美", "0911111111");
    expect(store.checkInRosterEntry).toHaveBeenCalledWith("roster-1", "self");
  });

  it("hands over a finished portrait as a private link", async () => {
    store.checkInRosterEntry.mockResolvedValue({
      name: "王小美",
      seat: "A1",
      checkedInAt: "2026-11-10T06:02:00.000Z",
      alreadyCheckedIn: true,
      portrait: { status: "complete", accessToken: "tok_123" },
    });

    const payload = await (await checkIn(GUEST)).json();

    expect(payload.portrait).toEqual({
      status: "complete",
      url: "/api/check-in/portrait/tok_123",
    });
    expect(payload).not.toHaveProperty("portrait.accessToken");
  });

  it("refuses everyone while check-in is closed, before any lookup", async () => {
    store.readCheckInSettings.mockResolvedValue({ open: false, updatedAt: null });

    const response = await checkIn(GUEST);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ closed: true });
    expect(store.findRosterMatch).not.toHaveBeenCalled();
    expect(store.checkInRosterEntry).not.toHaveBeenCalled();
  });

  it("rejects guests who are not on the roster", async () => {
    store.findRosterMatch.mockResolvedValue(null);

    const response = await checkIn(GUEST);

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("找不到");
    expect(store.checkInRosterEntry).not.toHaveBeenCalled();
  });

  it("validates the form", async () => {
    expect((await checkIn({ name: "", phone: "0911111111" })).status).toBe(400);
    expect((await checkIn({ name: "王小美", phone: "123" })).status).toBe(400);
    expect(store.findRosterMatch).not.toHaveBeenCalled();
  });

  it("treats an entry deleted mid-check-in like no match", async () => {
    store.checkInRosterEntry.mockRejectedValue(new RosterNotFoundError());
    expect((await checkIn(GUEST)).status).toBe(403);
  });

  it("reports Firestore being unavailable as 503", async () => {
    store.readCheckInSettings.mockRejectedValue(new RosterUnavailableError());
    expect((await checkIn(GUEST)).status).toBe(503);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/roster/verify/route";
import { RosterUnavailableError } from "@/lib/roster-store";

const { findRosterMatchMock } = vi.hoisted(() => ({
  findRosterMatchMock: vi.fn(),
}));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  findRosterMatch: findRosterMatchMock,
}));

function verify(body: unknown, ip = "203.0.113.7") {
  return POST(
    new Request("http://booth.local/api/roster/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  findRosterMatchMock.mockReset();
});

describe("POST /api/roster/verify", () => {
  it("confirms a guest on the roster without returning their record", async () => {
    findRosterMatchMock.mockResolvedValue({ id: "roster-1" });

    const response = await verify({ name: " 張小明 ", phone: "0912-345-678" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ matched: true });
    expect(findRosterMatchMock).toHaveBeenCalledWith("張小明", "0912345678");
  });

  it("rejects a guest who is not on the roster", async () => {
    findRosterMatchMock.mockResolvedValue(null);

    const response = await verify({ name: "張小明", phone: "0912345678" });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("找不到");
  });

  it("validates input before touching the roster", async () => {
    expect((await verify({ name: "", phone: "0912345678" })).status).toBe(400);
    expect((await verify({ name: "張小明", phone: "12345" })).status).toBe(400);
    expect((await verify(null)).status).toBe(400);
    expect(findRosterMatchMock).not.toHaveBeenCalled();
  });

  it("slows down repeated wrong phone guesses for one name", async () => {
    findRosterMatchMock.mockResolvedValue(null);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await verify({ name: "張小明", phone: "0912345678" })).status).toBe(403);
    }
    const blocked = await verify({ name: "張小明", phone: "0912345679" });
    expect(blocked.status).toBe(429);
    expect(findRosterMatchMock).toHaveBeenCalledTimes(8);

    // Another client is unaffected.
    expect(
      (await verify({ name: "張小明", phone: "0912345678" }, "198.51.100.1")).status,
    ).toBe(403);
  });

  it("does not lock out the next guest at the same booth", async () => {
    findRosterMatchMock.mockResolvedValue(null);
    // A run of guests mistyping, all behind the venue's single network address.
    for (let guest = 0; guest < 30; guest += 1) {
      expect((await verify({ name: `來賓${guest}`, phone: "0912345678" })).status).toBe(403);
    }

    findRosterMatchMock.mockResolvedValue({ id: "roster-1" });
    expect((await verify({ name: "王小美", phone: "0911111111" })).status).toBe(200);
  });

  it("reports the roster being unavailable as 503", async () => {
    findRosterMatchMock.mockRejectedValue(new RosterUnavailableError());

    const response = await verify({ name: "張小明", phone: "0912345678" });

    expect(response.status).toBe(503);
  });
});

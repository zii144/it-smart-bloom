import { beforeEach, describe, expect, it } from "vitest";
import { buildSeatBoard, seatStatusData } from "@/lib/seat-status";
import { createDisplaySession, verifyDisplaySession } from "@/lib/seat-status-auth";
import { verifyAdminToken } from "@/lib/admin-auth";

beforeEach(() => { process.env.ADMIN_DASHBOARD_SECRET = "test-display-secret"; });

describe("seat display boundary", () => {
  it("whitelists only display fields, including on a legacy roster entry", () => {
    const privateEntry = { seat: "A1", name: "Private name", mobile: "0912345678", portraitAccessToken: "private" };
    expect(seatStatusData(privateEntry)).toEqual({ seat: "A1", checkedInAt: null });
  });

  it("counts unassigned arrivals, naturally sorts seats, and flags shared assignments", () => {
    const board = buildSeatBoard([
      { id: "1", seat: "A10", checkedInAt: null },
      { id: "2", seat: " ａ２ ", checkedInAt: "2026-11-10T05:00:00Z" },
      { id: "3", seat: "A2", checkedInAt: null },
      { id: "4", seat: "", checkedInAt: "2026-11-10T05:01:00Z" },
    ]);
    expect(board).toMatchObject({ total: 4, arrived: 2, waiting: 2, unassigned: 1, conflicts: 1, sections: ["A"] });
    expect(board.seats.map((seat) => seat.label)).toEqual(["A2", "A10"]);
    expect(board.seats[0]).toMatchObject({ assigned: 2, arrived: 1 });
    expect(board.recent).toHaveLength(1);
    expect(buildSeatBoard([])).toMatchObject({ total: 0, arrived: 0, seats: [] });
  });

  it("display sessions cannot authorize admin actions, and reject tampering or expiry", () => {
    const session = createDisplaySession(1_000);
    expect(verifyDisplaySession(session.token, 2_000)).toMatchObject({ id: session.id, expiresAt: session.expiresAt });
    expect(verifyAdminToken(session.token)).toBe(false);
    expect(verifyDisplaySession(session.token, session.expiresAt)).toBeNull();
    expect(verifyDisplaySession(`${session.token}x`, 2_000)).toBeNull();
    expect(verifyDisplaySession(session.token.replace(session.id, "a".repeat(32)), 2_000)).toBeNull();
    process.env.ADMIN_DASHBOARD_SECRET = "rotated";
    expect(verifyDisplaySession(session.token, 2_000)).toBeNull();
  });
});

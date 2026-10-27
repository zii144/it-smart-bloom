import { beforeEach, describe, expect, it, vi } from "vitest";
import { RosterUnavailableError } from "@/lib/roster-store";
import { createSession } from "@/lib/sessions";
import { EVENT_RUNDOWN_URL } from "@/lib/event-info";
import { loadSuccessView } from "@/lib/success-view";
import { imageFile } from "./helpers";

const { readRosterGuestMock } = vi.hoisted(() => ({ readRosterGuestMock: vi.fn() }));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  readRosterGuest: readRosterGuestMock,
}));

beforeEach(() => {
  readRosterGuestMock.mockReset();
  readRosterGuestMock.mockResolvedValue({ name: "王小美" });
});

describe("loadSuccessView", () => {
  it("greets the roster guest by name with the event rundown QR", async () => {
    const session = await createSession(imageFile(), undefined, undefined, {
      rosterEntryId: "roster-1",
    });

    const view = await loadSuccessView(session.id);

    expect(readRosterGuestMock).toHaveBeenCalledWith("roster-1");
    expect(view).toMatchObject({
      kind: "ready",
      guestName: "王小美",
      rundownUrl: EVENT_RUNDOWN_URL,
    });
    // QA: the seat is not part of the success card.
    expect(view).not.toHaveProperty("seat");
    expect(view.kind === "ready" && view.rundownQrDataUrl.startsWith("data:image/png")).toBe(true);
    // The portrait is collected at check-in; nothing here points at the session.
    expect(JSON.stringify(view)).not.toContain(session.id);
  });

  it("still celebrates when the roster cannot be read", async () => {
    readRosterGuestMock.mockRejectedValue(new RosterUnavailableError());
    const session = await createSession(imageFile(), undefined, undefined, {
      rosterEntryId: "roster-1",
    });

    await expect(loadSuccessView(session.id)).resolves.toMatchObject({
      kind: "ready",
      guestName: null,
    });
  });

  it("does not look anyone up for a session without a roster link", async () => {
    const session = await createSession(imageFile());
    await loadSuccessView(session.id);
    expect(readRosterGuestMock).not.toHaveBeenCalled();
  });

  it("reports expired and unknown links instead of throwing", async () => {
    const session = await createSession(imageFile());
    vi.useFakeTimers({ now: Date.parse(session.expiresAt) + 1000, toFake: ["Date"] });
    try {
      await expect(loadSuccessView(session.id)).resolves.toEqual({ kind: "expired" });
    } finally {
      vi.useRealTimers();
    }
    await expect(loadSuccessView("not-a-session")).resolves.toEqual({ kind: "missing" });
    await expect(loadSuccessView("A".repeat(32))).resolves.toEqual({ kind: "missing" });
  });
});

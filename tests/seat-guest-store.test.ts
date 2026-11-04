import { expect, it, vi } from "vitest";
import { readSeatGuests } from "@/lib/seat-guest-store";
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), doc: vi.fn((id: string) => ({ id })) }));
vi.mock("@/lib/firebase-admin", () => ({ getDb: () => ({ collection: () => ({ doc: mocks.doc }), getAll: mocks.getAll }) }));

it("reads selected fields only and excludes deleted or reassigned guests", async () => {
  mocks.getAll.mockResolvedValue([
    { id: "one", data: () => ({ name: "來賓", role: "路老師", seat: "ａ１", checkedInAt: null, mobile: "private", note: "private" }) },
    { id: "moved", data: () => ({ name: "已換位", seat: "A2" }) },
    { id: "deleted", data: () => undefined },
  ]);
  expect(await readSeatGuests("A1", ["one", "moved", "deleted"])).toEqual([
    { id: "one", name: "來賓", role: "路老師", seat: "A1", checkedInAt: null },
  ]);
  expect(mocks.getAll).toHaveBeenCalledWith({ id: "one" }, { id: "moved" }, { id: "deleted" }, { fieldMask: ["name", "role", "seat", "checkedInAt"] });
});

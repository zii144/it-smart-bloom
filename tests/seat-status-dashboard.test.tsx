// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SeatStatusDashboard } from "@/components/seat-status-dashboard";
import type { SeatStatusSnapshot } from "@/lib/seat-status";
import type { SeatConnection } from "@/lib/seat-status-client";

const feed = vi.hoisted(() => ({ useSeatStatus: vi.fn() }));
vi.mock("@/lib/seat-status-client", () => feed);

let snapshot: SeatStatusSnapshot | null;
let connection: SeatConnection;
let resize: ResizeObserverCallback;

beforeEach(() => {
  vi.useFakeTimers();
  snapshot = {
    entries: [
      { id: "1", seat: "A1", checkedInAt: "2026-11-10T05:00:00Z" },
      { id: "2", seat: "A2", checkedInAt: null },
      { id: "3", seat: "A3", checkedInAt: null },
      { id: "4", seat: "A4", checkedInAt: null },
      { id: "5", seat: "B1", checkedInAt: "2026-11-10T05:01:00Z" },
    ],
    checkIn: { open: true, updatedAt: null },
    verifiedAt: "2026-11-10T05:02:00Z",
  };
  connection = "live";
  feed.useSeatStatus.mockReset();
  feed.useSeatStatus.mockImplementation(() => ({ snapshot, connection }));
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {
      // Four readable seats fit in this simulated display region.
      resize([{ contentRect: { width: 144, height: 136 } }] as ResizeObserverEntry[], this as unknown as ResizeObserver);
    }
    disconnect() {}
  });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("rotates overflowing seats, supports pause/manual paging, and filters without changing totals", () => {
  const view = render(<SeatStatusDashboard />);
  expect(view.getByLabelText("A1，已報到")).toBeTruthy();
  expect(view.queryByLabelText("B1，已報到")).toBeNull();
  act(() => { vi.advanceTimersByTime(12_000); });
  expect(view.getByLabelText("B1，已報到")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "暫停輪播" }));
  act(() => { vi.advanceTimersByTime(24_000); });
  expect(view.getByLabelText("B1，已報到")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "下一頁座位" }));
  expect(view.getByLabelText("A1，已報到")).toBeTruthy();
  fireEvent.change(view.getByRole("combobox", { name: "篩選座位區域" }), { target: { value: "B" } });
  expect(view.getByLabelText("B1，已報到")).toBeTruthy();
  expect(view.queryByLabelText("A1，已報到")).toBeNull();
  expect(view.queryByRole("button", { name: "下一頁座位" })).toBeNull();
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
});

it("reflows pagination after resize and clamps a page when the roster shrinks", () => {
  const view = render(<SeatStatusDashboard />);
  fireEvent.click(view.getByRole("button", { name: "下一頁座位" }));
  snapshot = { ...snapshot!, entries: snapshot!.entries.slice(0, 2) };
  view.rerender(<SeatStatusDashboard />);
  expect(view.getByLabelText("A1，已報到")).toBeTruthy();
  expect(view.queryByRole("button", { name: "下一頁座位" })).toBeNull();
  act(() => { resize([{ contentRect: { width: 72, height: 68 } }] as ResizeObserverEntry[], {} as ResizeObserver); });
  expect(view.getByRole("button", { name: "下一頁座位" })).toBeTruthy();
  expect(view.getByLabelText("A2，尚未報到")).toBeTruthy();
  expect(view.queryByLabelText("A1，已報到")).toBeNull();
});

it("keeps arrivals and last-sync time visible offline, and applies an undo on reconnect", () => {
  const view = render(<SeatStatusDashboard />);
  connection = "offline";
  view.rerender(<SeatStatusDashboard />);
  expect(view.getByRole("status").textContent).toContain("連線中斷");
  expect(view.getByLabelText("A1，已報到")).toBeTruthy();
  expect(view.getByText("最後同步 13:02")).toBeTruthy();
  connection = "live";
  snapshot = { ...snapshot!, entries: snapshot!.entries.map((entry) => ({ ...entry, checkedInAt: null })) };
  view.rerender(<SeatStatusDashboard />);
  expect(view.getByLabelText("A1，尚未報到")).toBeTruthy();
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  expect(view.getByText("等候第一份抵達")).toBeTruthy();
});

it("shows assignment conflicts and counts guests without seats", () => {
  snapshot = {
    ...snapshot!,
    entries: [
      { id: "1", seat: "A1", checkedInAt: "2026-11-10T05:00:00Z" },
      { id: "2", seat: "a1", checkedInAt: null },
      { id: "3", seat: "", checkedInAt: "2026-11-10T05:01:00Z" },
    ],
  };
  const view = render(<SeatStatusDashboard />);
  expect(view.getByLabelText("A1，重複分配 2 位，已報到 1 位")).toBeTruthy();
  expect(view.getByText("重複座位 1")).toBeTruthy();
  expect(view.getByText("1 位尚未分配座位（已計入總人數）")).toBeTruthy();
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("67");
});

it("keeps preview clearly labelled, sends no writes, and returns to authorization", () => {
  snapshot = null;
  connection = "auth-required";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard />);
  expect(view.getByRole("dialog", { name: "啟用座位看板" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "先預覽看板版面" }));
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByRole("status").textContent).toBe("示範資料・非即時報到");
  expect(view.getByLabelText("A1，已報到")).toBeTruthy();
  expect(feed.useSeatStatus).toHaveBeenLastCalledWith(0, true);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "返回即時看板" }));
  expect(view.getByRole("dialog")).toBeTruthy();
  expect(feed.useSeatStatus).toHaveBeenLastCalledWith(0, false);
});

it("shows a failed sign-in, permits retry, and clears the password after success", async () => {
  snapshot = null;
  connection = "auth-required";
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: "密碼錯誤" }), { status: 401 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard />);
  const dialog = within(view.getByRole("dialog"));
  const input = dialog.getByLabelText("工作人員密碼") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "test-password" } });
  await act(async () => { fireEvent.submit(input.closest("form")!); });
  expect(dialog.getByRole("alert").textContent).toBe("密碼錯誤");
  expect(input.value).toBe("test-password");
  await act(async () => { fireEvent.submit(input.closest("form")!); });
  expect(input.value).toBe("");
  expect(dialog.queryByRole("alert")).toBeNull();
  expect(feed.useSeatStatus).toHaveBeenLastCalledWith(1, false);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/seat-status/access", expect.objectContaining({
    method: "POST", credentials: "same-origin", body: JSON.stringify({ key: "test-password" }),
  }));
});

it("reports unsupported fullscreen and lets the user dismiss it", async () => {
  const view = render(<SeatStatusDashboard />);
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "進入全螢幕" })); });
  expect(view.getByRole("alert").textContent).toContain("此瀏覽器不支援全螢幕");
  fireEvent.click(view.getByRole("button", { name: "關閉提示" }));
  expect(view.queryByRole("alert")).toBeNull();
});

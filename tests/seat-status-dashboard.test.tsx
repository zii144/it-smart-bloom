// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SeatStatusDashboard } from "@/components/seat-status-dashboard";
import type { SeatStatusSnapshot } from "@/lib/seat-status";
import type { SeatConnection } from "@/lib/seat-status-client";

const feed = vi.hoisted(() => ({ useSeatStatus: vi.fn() }));
vi.mock("@/lib/seat-status-client", () => feed);

let snapshot: SeatStatusSnapshot | null;
let connection: SeatConnection;

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

});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("hydrates the server-rendered preview without rebuilding the SVG seat titles", async () => {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<SeatStatusDashboard initialPreview />);
  document.body.appendChild(container);
  const originalMap = container.querySelector("svg");
  const recoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, <SeatStatusDashboard initialPreview />, { onRecoverableError: recoverableError });
    });
    expect(recoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("svg")).toBe(originalMap);
    expect(container.querySelector('[aria-label="A1，尚未報到"] title')?.textContent).toBe("A1・尚未報到");
    expect(container.querySelector('[aria-label="N1，已報到"] title')?.textContent).toBe("N1・已報到・13:10");
  } finally {
    await act(async () => { root?.unmount(); });
    container.remove();
  }
});

it("keeps all 180 seats in the reference positions, including aisles and venue markers", () => {
  const view = render(<SeatStatusDashboard />);
  const map = view.getByRole("group", { name: /114及115年度/ });
  expect(map.getAttribute("viewBox")).toBe("0 0 418 745");
  expect(view.getByLabelText("A 至 O 排座位").querySelectorAll("g[aria-label] rect")).toHaveLength(180);
  const rect = (label: string) => view.getByLabelText(label).querySelector("rect")!;
  expect(rect("A1，已報到").getAttribute("x")).toBe("57");
  expect(rect("A4，尚未報到").getAttribute("x")).toBe("129");
  expect(rect("A5，尚未分配").getAttribute("x")).toBe("174");
  expect(rect("A9，尚未分配").getAttribute("x")).toBe("289");
  expect(rect("C1，尚未分配").getAttribute("y")).toBe("245");
  expect(rect("D1，尚未分配").getAttribute("y")).toBe("294");
  expect(rect("J1，尚未分配").getAttribute("y")).toBe("504");
  expect(rect("K1，尚未分配").getAttribute("y")).toBe("554");
  expect(rect("O12，尚未分配").getAttribute("x")).toBe("361");
  expect(view.getByLabelText("VIP 第 1 排，場地標示").querySelectorAll("rect")).toHaveLength(12);
  expect(view.getByLabelText("VIP 第 2 排，場地標示").querySelectorAll("rect")).toHaveLength(12);
  expect(map.textContent).toContain("茶水區");
  expect(view.queryByRole("button", { name: "下一頁座位" })).toBeNull();
});

it("keeps out-of-plan assignments visible in diagnostics without inventing seats", () => {
  snapshot = { ...snapshot!, entries: [...snapshot!.entries, { id: "outside", seat: "Z99", checkedInAt: null }] };
  const view = render(<SeatStatusDashboard />);
  expect(view.queryByLabelText("Z99，尚未報到")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "看板資訊" }));
  expect(view.getByText(/場地圖外的座位：Z99/)).toBeTruthy();
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");
});

it("keeps arrivals and last-sync time visible offline, and applies an undo on reconnect", () => {
  const view = render(<SeatStatusDashboard />);
  connection = "offline";
  view.rerender(<SeatStatusDashboard />);
  expect(view.getByRole("status").textContent).toContain("連線中斷");
  expect(view.getByLabelText("A1，已報到")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "看板資訊" }));
  expect(view.getByText(/最後同步 13:02/)).toBeTruthy();
  connection = "live";
  snapshot = { ...snapshot!, entries: snapshot!.entries.map((entry) => ({ ...entry, checkedInAt: null })) };
  view.rerender(<SeatStatusDashboard />);
  expect(view.getByLabelText("A1，尚未報到")).toBeTruthy();
  expect(view.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
  expect(view.getByRole("status").textContent).toBe("即時連線");
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
  fireEvent.click(view.getByRole("button", { name: "看板資訊" }));
  expect(view.getByText(/重複座位 1/)).toBeTruthy();
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
  expect(view.getByLabelText("N1，已報到")).toBeTruthy();
  expect(feed.useSeatStatus).toHaveBeenLastCalledWith(0, true);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "看板資訊" }));
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

it("opens the review link directly in clearly labelled preview without enrolling a display", () => {
  snapshot = null;
  connection = "auth-required";
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard initialPreview />);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByRole("status").textContent).toBe("示範資料・非即時報到");
  expect(view.getByLabelText("A1，尚未報到")).toBeTruthy();
  expect(view.getByLabelText("O12，已報到")).toBeTruthy();
  expect(feed.useSeatStatus).toHaveBeenLastCalledWith(0, true);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("opens demo guest information on hover, keeps it open while reading, and dismisses with Escape", () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard initialPreview />);
  const seat = view.getByLabelText("A1，尚未報到");
  fireEvent.pointerEnter(seat);
  const card = view.getByRole("dialog", { name: "A1 來賓資訊" });
  expect(within(card).getByText("陳怡安")).toBeTruthy();
  expect(within(card).getByText("示範資料")).toBeTruthy();
  fireEvent.pointerLeave(seat);
  fireEvent.pointerEnter(card);
  act(() => vi.advanceTimersByTime(200));
  expect(view.getByRole("dialog")).toBeTruthy();
  fireEvent.keyDown(seat, { key: "Escape" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("loads guest details on keyboard focus and updates check-in status without refetching", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ guests: [
    { id: "1", name: "測試來賓", role: "路老師", seat: "A1", checkedInAt: "2026-11-10T05:00:00Z" },
  ] })));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard />);
  fireEvent.focus(view.getByLabelText("A1，已報到"));
  expect(view.getByText("正在讀取來賓資料…")).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(150); });
  const card = within(view.getByRole("dialog", { name: "A1 來賓資訊" }));
  expect(card.getByText("測試來賓")).toBeTruthy();
  expect(card.getByText("路老師")).toBeTruthy();
  expect(card.getByText("✓ 已報到")).toBeTruthy();
  expect(card.getByText("13:00")).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith("/api/seat-status/guests?seat=A1&ids=1", expect.objectContaining({ credentials: "same-origin", cache: "no-store" }));
  snapshot = { ...snapshot!, entries: snapshot!.entries.map((entry) => ({ ...entry, checkedInAt: null })) };
  view.rerender(<SeatStatusDashboard />);
  expect(card.getByText("○ 尚未報到")).toBeTruthy();
  expect(card.queryByText("13:00")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("supports tapping unassigned seats and dismissing outside without a guest request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard />);
  fireEvent.click(view.getByLabelText("A5，尚未分配"));
  expect(view.getByText("此座位尚未分配來賓。")).toBeTruthy();
  await act(async () => { vi.advanceTimersByTime(200); });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.pointerDown(view.getByLabelText("報到狀態圖例"));
  expect(view.queryByRole("dialog")).toBeNull();
});

it("aborts a previous guest lookup when moving between seats and ignores its late response", async () => {
  let resolveFirst!: (response: Response) => void;
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ guests: [{ id: "2", name: "第二位來賓", role: "", seat: "A2", checkedInAt: null }] })));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard />);
  fireEvent.pointerEnter(view.getByLabelText("A1，已報到"));
  await act(async () => { vi.advanceTimersByTime(150); });
  const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  fireEvent.pointerEnter(view.getByLabelText("A2，尚未報到"));
  await act(async () => { vi.advanceTimersByTime(150); });
  expect(firstSignal.aborted).toBe(true);
  await act(async () => { resolveFirst(new Response(JSON.stringify({ guests: [{ id: "1", name: "過期資料" }] }))); });
  expect(view.getByText("第二位來賓")).toBeTruthy();
  expect(view.queryByText("過期資料")).toBeNull();
  connection = "auth-required";
  view.rerender(<SeatStatusDashboard />);
  expect(view.queryByText("第二位來賓")).toBeNull();
});

it("offers a retry after a guest lookup failure", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ guests: [{ id: "1", name: "重試來賓", role: "", seat: "A1", checkedInAt: null }] })));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<SeatStatusDashboard />);
  fireEvent.click(view.getByLabelText("A1，已報到"));
  await act(async () => { vi.advanceTimersByTime(150); });
  expect(view.getByRole("alert").textContent).toContain("暫時無法讀取");
  fireEvent.click(view.getByRole("button", { name: "重試" }));
  await act(async () => { vi.advanceTimersByTime(150); });
  expect(view.getByText("重試來賓")).toBeTruthy();
});

it("re-flows the same 180 seats into the 16:9 layout and switches back to the portrait plan", () => {
  const view = render(<SeatStatusDashboard initialWide />);
  const map = view.getByRole("group", { name: /114及115年度/ });
  expect(map.getAttribute("viewBox")).toBe("0 0 1600 900");
  expect(view.getByLabelText("A 至 O 排座位").querySelectorAll("g[aria-label] rect")).toHaveLength(180);
  const rect = (label: string) => view.getByLabelText(label).querySelector("rect")!;
  expect(rect("A1，已報到").getAttribute("width")).toBe("96");
  // Aisles survive the re-flow: wider gaps after seats 4 and 8, and after rows C and J.
  expect(Number(rect("A5，尚未分配").getAttribute("x")) - Number(rect("A4，尚未報到").getAttribute("x"))).toBe(166);
  expect(Number(rect("D1，尚未分配").getAttribute("y")) - Number(rect("C1，尚未分配").getAttribute("y"))).toBe(62);
  expect(Number(rect("K1，尚未分配").getAttribute("y")) - Number(rect("J1，尚未分配").getAttribute("y"))).toBe(62);
  expect(view.getByLabelText("VIP 第 2 排，場地標示").querySelectorAll("rect")).toHaveLength(12);
  // The map owns the whole screen: no legend or side panel, only the toolbar.
  expect(view.queryByLabelText("報到狀態圖例")).toBeNull();
  expect(view.getByRole("status").textContent).toBe("即時連線");
  fireEvent.click(view.getByRole("button", { name: "切換為直式版面" }));
  expect(view.getByRole("group", { name: /114及115年度/ }).getAttribute("viewBox")).toBe("0 0 418 745");
  expect(window.location.search).toBe("");
  fireEvent.click(view.getByRole("button", { name: "切換為 16:9 版面" }));
  expect(window.location.search).toBe("?layout=16x9");
  window.history.replaceState(null, "", window.location.pathname);
});

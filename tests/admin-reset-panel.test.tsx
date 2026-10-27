// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminResetPanel } from "@/components/admin-reset-panel";

const PREVIEW = {
  environment: "live",
  counts: { roster: 151, checkedIn: 12, sessions: 40, usage: 3 },
  lastReset: null,
};

let fetchMock: ReturnType<typeof vi.fn>;
let calls: string[];

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url === "/api/admin30910/reset" && !init?.method) return Response.json(PREVIEW);
    if (url.startsWith("/api/admin30910/reset/backup")) {
      return new Response("{}", {
        headers: { "Content-Disposition": 'attachment; filename="bloom-backup-x.json"' },
      });
    }
    if (url === "/api/admin30910/reset" && init?.method === "POST") {
      return Response.json({
        reset: {
          at: "2026-10-27T00:00:00.000Z",
          categories: ["checkIns"],
          counts: { checkInsCleared: 151 },
          environment: "live",
        },
      });
    }
    return Response.json({ error: "unexpected" }, { status: 500 });
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function option(container: HTMLElement, label: string) {
  return [...container.querySelectorAll<HTMLLabelElement>(".admin-reset-option")].find((el) =>
    el.textContent?.includes(label),
  )!;
}

describe("AdminResetPanel", () => {
  it("warns loudly when connected to the live project and shows current sizes", async () => {
    const { findByText, container } = render(<AdminResetPanel active />);
    expect(await findByText("正式環境・會刪除真實資料")).toBeTruthy();
    expect(option(container, "名單").textContent).toContain("151 位來賓");
    expect(option(container, "報到紀錄").textContent).toContain("12 位已報到");
  });

  it("stays disabled until a category is chosen and the phrase is typed", async () => {
    const { container, findByText } = render(<AdminResetPanel active />);
    await findByText("正式環境・會刪除真實資料");
    const button = container.querySelector<HTMLButtonElement>(".admin-reset-button")!;
    expect(button.disabled).toBe(true);

    fireEvent.click(option(container, "報到紀錄").querySelector("input")!);
    expect(button.disabled).toBe(true);

    fireEvent.change(container.querySelector(".admin-reset-confirm input")!, {
      target: { value: "確認" },
    });
    expect(button.disabled).toBe(true);

    fireEvent.change(container.querySelector(".admin-reset-confirm input")!, {
      target: { value: "確認重置" },
    });
    expect(button.disabled).toBe(false);
  });

  it("downloads the backup before resetting, then reloads the other tabs", async () => {
    const onReset = vi.fn();
    const { container, findByText } = render(<AdminResetPanel active onReset={onReset} />);
    await findByText("正式環境・會刪除真實資料");

    fireEvent.click(option(container, "報到紀錄").querySelector("input")!);
    fireEvent.change(container.querySelector(".admin-reset-confirm input")!, {
      target: { value: "確認重置" },
    });
    fireEvent.click(container.querySelector(".admin-reset-button")!);

    expect(await findByText(/已重置。備份：bloom-backup-x\.json/)).toBeTruthy();
    const backupAt = calls.findIndex((call) => call.startsWith("GET /api/admin30910/reset/backup?categories=checkIns"));
    const resetAt = calls.indexOf("POST /api/admin30910/reset");
    expect(backupAt).toBeGreaterThan(-1);
    expect(resetAt).toBeGreaterThan(backupAt);
    expect(JSON.parse(fetchMock.mock.calls[resetAt]![1].body)).toEqual({
      categories: ["checkIns"],
      confirmation: "確認重置",
    });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("never resets when the backup fails", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url === "/api/admin30910/reset" && !init?.method) return Response.json(PREVIEW);
      return Response.json({ error: "boom" }, { status: 500 });
    });
    const { container, findByText } = render(<AdminResetPanel active />);
    await findByText("正式環境・會刪除真實資料");

    fireEvent.click(option(container, "用量統計").querySelector("input")!);
    fireEvent.change(container.querySelector(".admin-reset-confirm input")!, {
      target: { value: "確認重置" },
    });
    fireEvent.click(container.querySelector(".admin-reset-button")!);

    expect(await findByText(/備份失敗/)).toBeTruthy();
    await waitFor(() => expect(calls.some((call) => call.startsWith("POST"))).toBe(false));
  });

  it("folds check-ins into a roster reset instead of sending both", async () => {
    const { container, findByText } = render(<AdminResetPanel active />);
    await findByText("正式環境・會刪除真實資料");

    fireEvent.click(option(container, "名單").querySelector("input")!);
    const checkIns = option(container, "報到紀錄").querySelector("input")!;
    expect(checkIns.checked).toBe(true);
    expect(checkIns.disabled).toBe(true);

    fireEvent.change(container.querySelector(".admin-reset-confirm input")!, {
      target: { value: "確認重置" },
    });
    fireEvent.click(container.querySelector(".admin-reset-button")!);
    await waitFor(() => expect(calls).toContain("POST /api/admin30910/reset"));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body).categories).toEqual(["roster"]);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AdminAdjustedBatch } from "@/components/admin-adjusted-batch";
import type { RosterEntry } from "@/lib/roster";

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));
vi.mock("@/lib/adjusted-upload-client", () => ({ sendAdjustedPortrait: sendMock }));

function entry(id: string, seat: string, name: string, extra: Partial<RosterEntry> = {}) {
  return {
    id,
    seat,
    name,
    role: "",
    mobile: "0912000000",
    extra: {},
    nameKey: name,
    matchKey: null,
    source: "admin",
    createdAt: "",
    updatedAt: "",
    portraitStatus: "complete",
    portraitSessionId: `sess-${id}`,
    portraitAdjustedAt: null,
    ...extra,
  } as RosterEntry;
}

const wang = entry("YHvDHMZvAbCdEfGh1234", "L5", "王小明");
const lin = entry("zplL1TxNAbCdEfGh5678", "E5", "林美麗");
const none = entry("noPortraitAbCdEfGh00", "Z9", "沒作品", {
  portraitStatus: null,
  portraitSessionId: null,
});
const entries = [wang, lin, none];

let blobs: Blob[];
let onChanged: Mock<() => Promise<void>>;

beforeEach(() => {
  blobs = [];
  sendMock.mockReset();
  sendMock.mockResolvedValue(undefined);
  onChanged = vi.fn(async () => {});
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => {
      blobs.push(blob);
      return "blob:x";
    }),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function pick(container: HTMLElement, files: File[]) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: files });
  fireEvent.change(input);
}

const file = (name: string, type = "image/png") =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });

describe("AdminAdjustedBatch", () => {
  it("zips every generated original under its match-ready name", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(`sess-${lin.id}`)) return new Response("nope", { status: 404 });
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/jpeg" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { getByText, findByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );

    fireEvent.click(getByText("下載全部原圖（zip）"));
    await findByText("已下載 1 張原圖。");

    // Only guests with a finished portrait, and only the generated original.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("kind=generated&original=1"))).toBe(true);
    const zip = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([`L5_王小明_${wang.id}.jpg`, "說明.txt"]);
    expect([...zip[`L5_王小明_${wang.id}.jpg`]]).toEqual([1, 2, 3]);
    expect(getByText(/E5 林美麗/)).toBeTruthy();
  });

  it("shows the match table and uploads only after confirmation", async () => {
    const { container, getByText, findByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );
    const good = file(`L5_王小明_${wang.id}.png`);
    pick(container, [good, file("E5.heic", "image/heic"), file("unknown.png")]);

    expect(getByText(/可上傳/).textContent).toContain("共 3 個檔案：可上傳 1");
    expect(getByText(/HEIC/)).toBeTruthy();
    expect(getByText(/對不到來賓/)).toBeTruthy();
    expect(sendMock).not.toHaveBeenCalled();

    fireEvent.click(getByText("確定上傳 1 張"));
    await findByText("完成 1/1 張。");
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledWith(wang.id, good);
    expect(onChanged).toHaveBeenCalled();
    // Nothing left to send: the button cannot upload the same file twice.
    expect(getByText("重試其餘 0 張").closest("button")!.disabled).toBe(true);
  });

  it("stops the run when the admin session expires, and retries only the rest", async () => {
    sendMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Unauthorized"));
    const { container, getByText, findByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );
    pick(container, [file("L5.png"), file("E5.png")]);
    fireEvent.click(getByText("確定上傳 2 張"));

    await findByText("已停止：Unauthorized");
    expect(sendMock).toHaveBeenCalledTimes(2);

    sendMock.mockResolvedValue(undefined);
    fireEvent.click(getByText("重試其餘 1 張"));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(3));
    expect(sendMock.mock.calls[2][0]).toBe(lin.id);
  });

  it("keeps going past a single bad file", async () => {
    sendMock.mockRejectedValueOnce(new Error("上傳的檔案不是有效的圖片。"));
    const { container, getByText, findByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );
    pick(container, [file("L5.png"), file("E5.png")]);
    fireEvent.click(getByText("確定上傳 2 張"));
    await findByText("完成 1/2 張，失敗 1 張。");
    expect(getByText("上傳的檔案不是有效的圖片。")).toBeTruthy();
  });

  it("saves nothing when no original could be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 401 })));
    const { getByText, findByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );
    fireEvent.click(getByText("下載全部原圖（zip）"));
    await findByText("沒有下載到任何原圖，請確認網路或重新登入後再試。");
    expect(blobs).toHaveLength(0);
  });

  it("downloads the current version, adjustments included, for another round", async () => {
    const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () =>
      new Response(new Uint8Array([9]), { headers: { "Content-Type": "image/png" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adjusted = [{ ...wang, portraitAdjustedAt: "2026-11-02T03:00:00Z" }, lin, none];
    const { getByText, findByText } = render(
      <AdminAdjustedBatch entries={adjusted} onChanged={onChanged} />,
    );
    fireEvent.click(getByText("下載目前版本"));
    await findByText("已下載 2 張目前版本。");
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("kind=result&original=1"))).toBe(true);
    const zip = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
    expect(Object.keys(zip)).toContain(`L5_王小明_${wang.id}.png`);
  });

  it("offers the current version only once something is adjusted", () => {
    const { getByText } = render(<AdminAdjustedBatch entries={entries} onChanged={onChanged} />);
    expect(getByText("下載目前版本").closest("button")!.disabled).toBe(true);
  });

  it("uploads up to three files at once", async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      entry(`guestNumber${index}AbCdEfGh`, `M${index}`, `來賓${index}`),
    );
    let inFlight = 0;
    let peak = 0;
    sendMock.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
    });
    const { container, getByText, findByText } = render(
      <AdminAdjustedBatch entries={many} onChanged={onChanged} />,
    );
    pick(container, many.map((guest) => file(`${guest.seat}.png`)));
    fireEvent.click(getByText("確定上傳 7 張"));
    await findByText("完成 7/7 張。");
    expect(peak).toBe(3);
    expect(sendMock).toHaveBeenCalledTimes(7);
  });

  it("stops when signing is unavailable instead of failing every large file", async () => {
    sendMock.mockRejectedValue(new Error("此環境只能上傳 4 MB 以下的圖片。"));
    const many = Array.from({ length: 6 }, (_, index) =>
      entry(`bigGuest${index}AbCdEfGhIj`, `N${index}`, `大檔${index}`),
    );
    const { container, getByText, findByText } = render(
      <AdminAdjustedBatch entries={many} onChanged={onChanged} />,
    );
    pick(container, many.map((guest) => file(`${guest.seat}.png`)));
    fireEvent.click(getByText("確定上傳 6 張"));
    await findByText(/已停止：此環境只能上傳/);
    // Only the files already in flight when it stopped were tried.
    expect(sendMock.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("filters the table down to the files that need attention", async () => {
    sendMock.mockRejectedValueOnce(new Error("上傳的檔案不是有效的圖片。"));
    const { container, getByText, findByText, queryByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );
    pick(container, [file("L5.png"), file("E5.png"), file("random.png")]);
    fireEvent.click(getByText("只看有問題或失敗（1）"));
    expect(queryByText("L5.png")).toBeNull();
    expect(getByText("random.png")).toBeTruthy();
    fireEvent.click(getByText("顯示全部"));

    fireEvent.click(getByText("確定上傳 2 張"));
    await findByText("完成 1/2 張，失敗 1 張。");
    // After a run with failures the table opens on just those rows.
    expect(getByText("顯示全部")).toBeTruthy();
    expect(queryByText("E5.png")).toBeNull();
    expect(getByText("L5.png")).toBeTruthy();
  });

  it("accepts dropped files and ignores hidden files and the instructions", async () => {
    const { container, findByText, getByText } = render(
      <AdminAdjustedBatch entries={entries} onChanged={onChanged} />,
    );
    const section = container.querySelector("section")!;
    const dropped = [file("L5.png"), file(".DS_Store", ""), file("說明.txt", "text/plain")];
    fireEvent.drop(section, { dataTransfer: { items: [], files: dropped } });
    await findByText(/共 1 個檔案/);
    expect(getByText("L5.png")).toBeTruthy();
  });
});

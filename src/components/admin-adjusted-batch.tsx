"use client";

import { strToU8, zipSync, type Zippable } from "fflate";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  extensionForType,
  hasFailedPortrait,
  hasPortrait,
  originalFilename,
  planAdjustedUploads,
  type UploadPlanRow,
} from "@/lib/adjusted-batch";
import { sendAdjustedPortrait } from "@/lib/adjusted-upload-client";
import { ADJUSTED_MIME_TYPES } from "@/lib/portrait-limits";
import type { RosterEntry } from "@/lib/roster";
import { saveBlob, taipeiDateStamp } from "@/lib/save-blob";

/** Enough to keep the network busy without flooding the image route. */
const DOWNLOAD_CONCURRENCY = 4;
/**
 * Each upload is a signed PUT plus a server-side check and preview build;
 * three at once cuts a 127-file batch from ~10 minutes to a few, while each
 * guest is still written independently.
 */
const UPLOAD_CONCURRENCY = 3;
const README_NAME = "說明.txt";

const README = `調整版作業說明

1. 修圖時請保留原本的檔名，例如 L5_王小明_xxxxxxxx.jpg。
   系統靠檔名裡的來賓編號（最後一段）找到對應的來賓。
   若改了檔名，也可以用座位（L5.jpg）或姓名（王小明.jpg）命名。
2. 匯出成 JPEG、PNG 或 WebP，每張 40 MB 以內。不支援 HEIC、PSD。
3. 回到「報到管理 → 調整版批次作業」，把整個資料夾拖進來（或選擇檔案），
   先核對配對表，確認無誤後再上傳。
4. 全部完成（已調整 = 有作品人數）後才開放報到。
`;

/**
 * A failed render has no original in the zip, so the instructions name the
 * file (with the guest id) that will complete it when uploaded.
 */
function readmeFor(entries: RosterEntry[]) {
  const failed = entries.filter(hasFailedPortrait);
  if (!failed.length) return README;
  const names = failed.map((entry) => `   ${originalFilename(entry, "jpg")}`).join("\n");
  return `${README}5. 以下來賓生成失敗，沒有原圖。修好的圖可直接上傳補上作品（不需重新生成），檔名請用：\n${names}\n`;
}

/** `generated`: the AI output to retouch. `result`: what guests get now, adjustments included. */
type DownloadSource = "generated" | "result";

type RowState = { state: "uploading" | "done" | "failed"; message?: string };

/**
 * Failures that would hit every remaining file the same way: the network or
 * Storage (including CORS), the admin session expiring, or URL signing being
 * unavailable so only small files could go through.
 */
const STOP_THE_RUN = /儲存空間|網路|CORS|Unauthorized|Forbidden|此環境只能上傳/;

/**
 * Everything dropped, folders included. Entries must be read synchronously
 * from the event, before any await, or the browser empties the DataTransfer.
 */
function filesFromDrop(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return Promise.resolve([...data.files]);

  const files: File[] = [];
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        ),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns at most ~100 entries per call.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  return (async () => {
    for (const entry of entries) await walk(entry);
    return files;
  })();
}

/** Hidden files and our own instructions are never meant as uploads. */
function isCandidateFile(file: File) {
  return !file.name.startsWith(".") && file.name !== README_NAME;
}

/**
 * Batch download of every original for retouching, and batch upload of the
 * retouched files matched back to guests by file name. Nothing is uploaded
 * until staff confirm the match table.
 */
export function AdminAdjustedBatch({
  entries,
  onChanged,
}: {
  entries: RosterEntry[];
  onChanged: () => Promise<void>;
}) {
  const guests = useMemo(() => entries.filter(hasPortrait), [entries]);
  const adjustedCount = guests.filter((guest) => guest.portraitAdjustedAt).length;
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ files: File[]; rows: UploadPlanRow[] } | null>(null);
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});
  const [uploading, setUploading] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Closing the tab mid-run would leave the batch half done.
  useEffect(() => {
    if (!uploading && !downloadProgress) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading, downloadProgress]);

  const ready = plan ? plan.rows.filter((row) => !row.problem) : [];
  /** Files already sent in this batch are never sent twice. */
  const pending = plan
    ? plan.rows.filter((row, index) => !row.problem && rowStates[index]?.state !== "done")
    : [];
  const replacing = ready.filter((row) => row.replaces).length;
  const completing = ready.filter((row) => row.completesFailed).length;
  const creating = ready.filter((row) => row.createsPortrait).length;
  const problems = plan ? plan.rows.length - ready.length : 0;
  const failedCount = Object.values(rowStates).filter((state) => state.state === "failed").length;
  const needsAttention = problems + failedCount;

  /** Zipped in the browser: a function response could never carry 127 originals. */
  async function downloadOriginals(source: DownloadSource) {
    setError(null);
    const files: Zippable = { [README_NAME]: strToU8(readmeFor(entries)) };
    const failed: string[] = [];
    let fetched = 0;
    let done = 0;
    const queue = [...guests];
    setDownloadProgress(`0/${guests.length}`);
    setNotice("正在下載原圖，請勿關閉此頁…");

    async function worker() {
      for (let guest = queue.shift(); guest; guest = queue.shift()) {
        try {
          const response = await fetch(
            `/api/admin30910/sessions/${guest.portraitSessionId}/image?kind=${source}&original=1`,
            { credentials: "same-origin" },
          );
          if (!response.ok) throw new Error(String(response.status));
          const bytes = new Uint8Array(await response.arrayBuffer());
          const name = originalFilename(guest, extensionForType(response.headers.get("content-type")));
          // JPEG/PNG are already compressed; storing them is faster and no bigger.
          files[name] = [bytes, { level: 0 }];
          fetched += 1;
        } catch {
          failed.push(`${guest.seat || "無座位"} ${guest.name}`);
        }
        done += 1;
        setDownloadProgress(`${done}/${guests.length}`);
      }
    }

    try {
      await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
      // A zip holding only the instructions would look like a finished download.
      if (!fetched) {
        setNotice(null);
        setError("沒有下載到任何原圖，請確認網路或重新登入後再試。");
        return;
      }
      const label = source === "result" ? "目前版本" : "調整版素材";
      saveBlob(
        new Blob([zipSync(files)], { type: "application/zip" }),
        `${label}-${taipeiDateStamp()}.zip`,
      );
      setNotice(`已下載 ${fetched} 張${source === "result" ? "目前版本" : "原圖"}。`);
      if (failed.length) setError(`以下來賓的圖無法下載：${failed.join("、")}`);
    } catch {
      setNotice(null);
      setError("打包失敗，請再試一次。");
    } finally {
      setDownloadProgress(null);
    }
  }

  function choose(list: File[]) {
    const files = list.filter(isCandidateFile);
    setError(null);
    setNotice(null);
    setRowStates({});
    setOnlyProblems(false);
    if (!files.length) {
      setPlan(null);
      return;
    }
    setPlan({ files, rows: planAdjustedUploads(files, entries) });
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;
    void filesFromDrop(event.dataTransfer).then(choose, () =>
      setError("無法讀取拖進來的檔案，請改用「選擇調整版檔案」。"),
    );
  }

  /**
   * A few files at a time, in table order. A failure that would hit every
   * remaining file the same way stops the run; a bad single file does not.
   */
  async function uploadAll() {
    if (!plan) return;
    const queue = plan.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row, index }) => !row.problem && row.guest && rowStates[index]?.state !== "done");
    const total = queue.length;
    let done = 0;
    let failed = 0;
    let stopped: string | null = null;
    setUploading(true);
    setError(null);
    setNotice(`上傳中 0/${total}，請勿關閉此頁…`);

    async function worker() {
      for (let item = queue.shift(); item && !stopped; item = queue.shift()) {
        const { row, index } = item;
        setRowStates((current) => ({ ...current, [index]: { state: "uploading" } }));
        try {
          await sendAdjustedPortrait(row.guest!.id, plan!.files[index]);
          done += 1;
          setRowStates((current) => ({ ...current, [index]: { state: "done" } }));
        } catch (caught) {
          failed += 1;
          const message = caught instanceof Error ? caught.message : "上傳失敗。";
          setRowStates((current) => ({ ...current, [index]: { state: "failed", message } }));
          if (STOP_THE_RUN.test(message)) stopped = message;
        }
        setNotice(`上傳中 ${done + failed}/${total}，請勿關閉此頁…`);
      }
    }

    await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
    setUploading(false);
    if (stopped) setError(`已停止：${stopped}`);
    setNotice(`完成 ${done}/${total} 張${failed ? `，失敗 ${failed} 張` : ""}。`);
    if (failed) setOnlyProblems(true);
    await onChanged();
  }

  const visibleRows = plan
    ? plan.rows
        .map((row, index) => ({ row, index }))
        .filter(
          ({ row, index }) =>
            !onlyProblems || row.problem || rowStates[index]?.state === "failed",
        )
    : [];

  return (
    <section
      className={`admin-adjusted-batch${dragging ? " is-dragging" : ""}`}
      aria-labelledby="adjusted-batch-title"
      onDragOver={(event) => {
        event.preventDefault();
        if (!uploading) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="admin-adjusted-batch-head">
        <div>
          <h3 id="adjusted-batch-title">調整版批次作業</h3>
          <p>
            已調整 <strong>{adjustedCount}</strong>/{guests.length}
            {adjustedCount < guests.length && guests.length > 0 && "・全部完成後再開放報到"}
          </p>
        </div>
        <div className="admin-adjusted-batch-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!guests.length || Boolean(downloadProgress) || uploading}
            onClick={() => void downloadOriginals("generated")}
          >
            {downloadProgress ? `下載中 ${downloadProgress}` : "下載全部原圖（zip）"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!adjustedCount || Boolean(downloadProgress) || uploading}
            title="含已上傳的調整版，適合再修一輪"
            onClick={() => void downloadOriginals("result")}
          >
            下載目前版本
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!guests.length || uploading}
            onClick={() => inputRef.current?.click()}
          >
            選擇調整版檔案…
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            accept={ADJUSTED_MIME_TYPES.join(",")}
            aria-label="選擇多張調整版檔案"
            onChange={(event) => {
              choose([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      <p className="admin-adjusted-drop-hint">
        {dragging ? "放開以讀取檔案" : "也可以把修好的整個資料夾拖到這裡。"}
      </p>

      {error && <p className="admin-banner">{error}</p>}
      {notice && <p className="admin-batch-hint admin-roster-notice">{notice}</p>}

      {plan && (
        <div className="admin-adjusted-plan">
          <p className="admin-adjusted-summary">
            共 {plan.rows.length} 個檔案：可上傳 <strong>{ready.length}</strong>
            {replacing > 0 && `（其中 ${replacing} 張會取代已上傳的調整版）`}
            {completing > 0 && `（其中 ${completing} 張會補上生成失敗的作品）`}
            {creating > 0 && `（其中 ${creating} 張會替沒有上傳照片的來賓建立作品）`}
            {problems > 0 && <>，<em>有問題 {problems}（不會上傳）</em></>}
          </p>
          {needsAttention > 0 && (
            <button
              type="button"
              className="admin-adjusted-filter"
              aria-pressed={onlyProblems}
              onClick={() => setOnlyProblems((current) => !current)}
            >
              {onlyProblems ? "顯示全部" : `只看有問題或失敗（${needsAttention}）`}
            </button>
          )}
          <ul className="admin-adjusted-rows">
            {visibleRows.map(({ row, index }) => {
              const state = rowStates[index];
              return (
                <li
                  key={`${row.fileName}-${index}`}
                  className={`admin-adjusted-row${row.problem ? " has-problem" : ""}${
                    state ? ` is-${state.state}` : ""
                  }`}
                >
                  <span className="admin-adjusted-file" title={row.fileName}>
                    {row.fileName}
                  </span>
                  <span className="admin-adjusted-arrow" aria-hidden="true">→</span>
                  <span className="admin-adjusted-guest">
                    {row.guest
                      ? `${row.guest.seat || "無座位"}・${row.guest.name}${
                          row.matchedBy === "seat"
                            ? "（依座位）"
                            : row.matchedBy === "name"
                              ? "（依姓名）"
                              : ""
                        }`
                      : "—"}
                  </span>
                  <span className="admin-adjusted-status">
                    {row.problem ??
                      (state?.state === "uploading"
                        ? "上傳中…"
                        : state?.state === "done"
                          ? "完成"
                          : state?.state === "failed"
                            ? state.message
                            : row.completesFailed
                              ? "生成失敗，以這張補上作品"
                              : row.createsPortrait
                                ? "沒有上傳照片，以這張建立作品"
                                : row.replaces
                                ? "會取代現有調整版"
                                : "待上傳")}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="admin-adjusted-batch-actions">
            <button
              type="button"
              className="primary-button"
              disabled={!pending.length || uploading}
              onClick={() => void uploadAll()}
            >
              {uploading
                ? "上傳中…"
                : pending.length < ready.length
                  ? `重試其餘 ${pending.length} 張`
                  : `確定上傳 ${ready.length} 張`}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={uploading}
              onClick={() => {
                setPlan(null);
                setRowStates({});
                setOnlyProblems(false);
              }}
            >
              清除
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

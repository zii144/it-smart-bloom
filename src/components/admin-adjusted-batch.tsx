"use client";

import { strToU8, zipSync, type Zippable } from "fflate";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  extensionForType,
  hasPortrait,
  originalFilename,
  planAdjustedUploads,
  type UploadPlanRow,
} from "@/lib/adjusted-batch";
import { sendAdjustedPortrait } from "@/lib/adjusted-upload-client";
import { ADJUSTED_MIME_TYPES } from "@/lib/portrait-limits";
import type { RosterEntry } from "@/lib/roster";

/** Enough to keep the network busy without flooding the image route. */
const DOWNLOAD_CONCURRENCY = 4;

const README = `調整版作業說明

1. 修圖時請保留原本的檔名，例如 L5_王小明_xxxxxxxx.jpg。
   系統靠檔名裡的來賓編號（最後一段）找到對應的來賓。
2. 匯出成 JPEG、PNG 或 WebP，每張 40 MB 以內。不支援 HEIC、PSD。
3. 回到「報到管理 → 調整版批次作業」選擇所有修好的檔案，
   先核對配對表，確認無誤後再上傳。
4. 全部完成（已調整 = 有作品人數）後才開放報到。
`;

type RowState = { state: "uploading" | "done" | "failed"; message?: string };

/**
 * Failures that would hit every remaining file the same way: the network or
 * Storage (including CORS), or the admin session expiring mid-run.
 */
const STOP_THE_RUN = /儲存空間|網路|CORS|Unauthorized|Forbidden/;

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
  const problems = plan ? plan.rows.length - ready.length : 0;

  /** Zipped in the browser: a function response could never carry 127 originals. */
  async function downloadOriginals() {
    setError(null);
    setNotice(null);
    const files: Zippable = { "說明.txt": strToU8(README) };
    const failed: string[] = [];
    let done = 0;
    const queue = [...guests];
    setDownloadProgress(`0/${guests.length}`);
    setNotice("正在下載原圖，請勿關閉此頁…");

    async function worker() {
      for (let guest = queue.shift(); guest; guest = queue.shift()) {
        try {
          const response = await fetch(
            `/api/admin30910/sessions/${guest.portraitSessionId}/image?kind=generated&original=1`,
            { credentials: "same-origin" },
          );
          if (!response.ok) throw new Error(String(response.status));
          const bytes = new Uint8Array(await response.arrayBuffer());
          const name = originalFilename(guest, extensionForType(response.headers.get("content-type")));
          // JPEG/PNG are already compressed; storing them is faster and no bigger.
          files[name] = [bytes, { level: 0 }];
        } catch {
          failed.push(`${guest.seat || "無座位"} ${guest.name}`);
        }
        done += 1;
        setDownloadProgress(`${done}/${guests.length}`);
      }
    }

    try {
      await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
      const blob = new Blob([zipSync(files)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
      link.href = url;
      link.download = `調整版素材-${stamp}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
      setNotice(`已下載 ${guests.length - failed.length} 張原圖。`);
      if (failed.length) setError(`以下來賓的原圖無法下載：${failed.join("、")}`);
    } catch {
      setError("打包失敗，請再試一次。");
    } finally {
      setDownloadProgress(null);
    }
  }

  function choose(list: FileList | null) {
    const files = [...(list ?? [])];
    setError(null);
    setNotice(null);
    setRowStates({});
    if (!files.length) {
      setPlan(null);
      return;
    }
    setPlan({ files, rows: planAdjustedUploads(files, entries) });
  }

  /**
   * One file at a time, in the order shown. A network or Storage problem
   * would fail every remaining file the same way, so it stops the run.
   */
  async function uploadAll() {
    if (!plan) return;
    setUploading(true);
    setError(null);
    let done = 0;
    let failed = 0;
    for (const [index, row] of plan.rows.entries()) {
      if (row.problem || !row.guest || rowStates[index]?.state === "done") continue;
      setRowStates((current) => ({ ...current, [index]: { state: "uploading" } }));
      setNotice(`上傳中 ${done + failed + 1}/${pending.length}，請勿關閉此頁…`);
      try {
        await sendAdjustedPortrait(row.guest.id, plan.files[index]);
        done += 1;
        setRowStates((current) => ({ ...current, [index]: { state: "done" } }));
      } catch (caught) {
        failed += 1;
        const message = caught instanceof Error ? caught.message : "上傳失敗。";
        setRowStates((current) => ({ ...current, [index]: { state: "failed", message } }));
        if (STOP_THE_RUN.test(message)) {
          setError(`已停止：${message}`);
          break;
        }
      }
    }
    setUploading(false);
    setNotice(`完成 ${done}/${pending.length} 張${failed ? `，失敗 ${failed} 張` : ""}。`);
    await onChanged();
  }

  return (
    <section className="admin-adjusted-batch" aria-labelledby="adjusted-batch-title">
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
            onClick={() => void downloadOriginals()}
          >
            {downloadProgress ? `下載中 ${downloadProgress}` : "下載全部原圖（zip）"}
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
              choose(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {error && <p className="admin-banner">{error}</p>}
      {notice && <p className="admin-batch-hint admin-roster-notice">{notice}</p>}

      {plan && (
        <div className="admin-adjusted-plan">
          <p className="admin-adjusted-summary">
            共 {plan.rows.length} 個檔案：可上傳 <strong>{ready.length}</strong>
            {replacing > 0 && `（其中 ${replacing} 張會取代已上傳的調整版）`}
            {problems > 0 && <>，<em>有問題 {problems}（不會上傳）</em></>}
          </p>
          <ul className="admin-adjusted-rows">
            {plan.rows.map((row, index) => {
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
                          row.matchedBy === "seat" ? "（依座位）" : ""
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

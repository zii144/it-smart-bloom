"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCheckInCsv, portraitLabel } from "@/lib/check-in-csv";
import { formatTaipeiTime } from "@/lib/event-info";
import {
  ADJUSTED_MIME_TYPES,
  isAdjustedMime,
  MAX_ADJUSTED_BYTES,
} from "@/lib/portrait-limits";
import { hasSubmittedPhoto, type RosterEntry } from "@/lib/roster";

type CheckInSettings = { open: boolean; updatedAt: string | null };
type Filter = "all" | "arrived" | "waiting";

/** Polling is only for the live arrival board; each read costs one roster scan. */
const REFRESH_MS = 10_000;
type UploadTarget =
  | {
      mode: "signed";
      uploadUrl: string;
      objectPath: string;
      /** Signed into the URL: the PUT must send exactly these. */
      headers: Record<string, string>;
    }
  | { mode: "direct"; maxBytes: number };

const MAX_ADJUSTED_MB = MAX_ADJUSTED_BYTES / 1024 / 1024;

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response;
}

/**
 * Vercel rejects function bodies over 4.5 MB, so the original goes straight
 * to Storage through a signed URL and the server then checks it. Only where
 * URLs cannot be signed (local emulators) does the file pass through the API.
 */
async function sendAdjustedPortrait(entryId: string, file: File) {
  const base = `/api/admin30910/roster/${entryId}/portrait`;
  const target = (await (
    await postJson(`${base}/upload-url`, { mime: file.type, size: file.size })
  ).json()) as UploadTarget;

  if (target.mode === "signed") {
    let put: Response;
    try {
      put = await fetch(target.uploadUrl, {
        method: "PUT",
        headers: target.headers,
        body: file,
      });
    } catch {
      throw new Error("無法上傳到儲存空間，請確認網路，或 Storage 的 CORS 設定。");
    }
    if (!put.ok) throw new Error(`上傳到儲存空間失敗（${put.status}），請再試一次。`);
    await postJson(base, { objectPath: target.objectPath });
    return;
  }

  if (file.size > target.maxBytes) {
    throw new Error(
      `此環境只能上傳 ${Math.floor(target.maxBytes / 1024 / 1024)} MB 以下的圖片。`,
    );
  }
  const body = new FormData();
  body.append("image", file);
  const response = await fetch(base, { method: "POST", body, credentials: "same-origin" });
  if (!response.ok) throw new Error(await readError(response));
}

type RosterPayload = { entries: RosterEntry[]; checkIn: CheckInSettings };

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || `操作失敗（${response.status}）`;
}

async function fetchRoster(): Promise<RosterPayload> {
  const response = await fetch("/api/admin30910/roster", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as RosterPayload;
}

function matchesQuery(entry: RosterEntry, query: string) {
  if (!query) return true;
  const haystack = [entry.name, entry.mobile ?? "", entry.seat, entry.role]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function downloadCsv(entries: RosterEntry[]) {
  const blob = new Blob([buildCheckInCsv(entries)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  link.href = url;
  link.download = `成果展報到-${stamp}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function AdminCheckInPanel({ active }: { active: boolean }) {
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [settings, setSettings] = useState<CheckInSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Kept apart from `error` so the 10-second refresh never wipes an action's error. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [confirmResubmitId, setConfirmResubmitId] = useState<string | null>(null);
  const [confirmRevertId, setConfirmRevertId] = useState<string | null>(null);
  const [confirmRegenerateId, setConfirmRegenerateId] = useState<string | null>(null);
  const [confirmRegenerateAll, setConfirmRegenerateAll] = useState(false);
  /** "3/13" while the bulk run is going; blocks a second run. */
  const [regenerateProgress, setRegenerateProgress] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<RosterEntry | null>(null);
  const [toggling, setToggling] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const applyPayload = useCallback((payload: RosterPayload) => {
    setEntries(payload.entries);
    setSettings(payload.checkIn);
    setLoadError(null);
    setLoading(false);
    setRefreshedAt(new Date().toISOString());
  }, []);

  const showLoadError = useCallback((caught: unknown) => {
    setLoadError(caught instanceof Error ? caught.message : "無法讀取報到資料。");
    setLoading(false);
  }, []);

  const reload = useCallback(async () => {
    try {
      applyPayload(await fetchRoster());
    } catch (caught) {
      showLoadError(caught);
    }
  }, [applyPayload, showLoadError]);

  // Live board: refresh while this tab is showing and the window is visible.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: number | undefined;

    function tick() {
      if (document.visibilityState === "visible") {
        fetchRoster().then(
          (payload) => {
            if (!cancelled) applyPayload(payload);
          },
          (caught) => {
            if (!cancelled) showLoadError(caught);
          },
        );
      }
      timer = window.setTimeout(tick, REFRESH_MS);
    }

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [active, applyPayload, showLoadError]);

  const arrived = entries.filter((entry) => entry.checkedInAt);
  const portraits = entries.filter((entry) => entry.portraitStatus === "complete");
  const failed = entries.filter(
    (entry) => entry.portraitStatus === "failed" && entry.portraitSessionId,
  );
  const rate = entries.length ? Math.round((arrived.length / entries.length) * 100) : 0;

  const visible = useMemo(() => {
    const list = entries.filter(
      (entry) =>
        (filter === "all" ||
          (filter === "arrived" ? Boolean(entry.checkedInAt) : !entry.checkedInAt)) &&
        matchesQuery(entry, query.trim()),
    );
    // The arrivals view reads like a live feed: latest first.
    if (filter === "arrived") {
      list.sort((left, right) =>
        (right.checkedInAt ?? "").localeCompare(left.checkedInAt ?? ""),
      );
    }
    return list;
  }, [entries, filter, query]);

  async function toggleOpen() {
    if (!settings) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/admin30910/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: !settings.open }),
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { checkIn: CheckInSettings };
      setSettings(payload.checkIn);
      setNotice(payload.checkIn.open ? "已開放報到。" : "已關閉報到。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法切換報到狀態。");
    } finally {
      setToggling(false);
    }
  }

  /** Lifts the one-photo limit; each extra submission is another generation. */
  async function allowResubmit(entry: RosterEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin30910/roster/${entry.id}/submission`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(`已允許 ${entry.name} 重新上傳照片。`);
      setConfirmResubmitId(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法開放重新上傳。");
    } finally {
      setBusyId(null);
    }
  }

  function chooseAdjustedImage(entry: RosterEntry) {
    uploadTargetRef.current = entry;
    uploadInputRef.current?.click();
  }

  /** Replaces what this guest receives; already checked-in guests see it on reload. */
  async function uploadAdjusted(file: File) {
    const entry = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!entry) return;
    if (!isAdjustedMime(file.type)) {
      setError("請使用 JPEG、PNG 或 WebP 格式的圖片。");
      return;
    }
    if (file.size > MAX_ADJUSTED_BYTES) {
      setError(`圖片必須小於 ${MAX_ADJUSTED_MB} MB。`);
      return;
    }
    setBusyId(entry.id);
    setError(null);
    setNotice(`正在上傳 ${entry.name} 的調整版…`);
    try {
      await sendAdjustedPortrait(entry.id, file);
      setNotice(`已更新 ${entry.name} 的似顏繪，來賓重新整理即可看到。`);
      await reload();
    } catch (caught) {
      setNotice(null);
      setError(caught instanceof Error ? caught.message : "無法上傳調整後的作品。");
    } finally {
      setBusyId(null);
    }
  }

  /** One OpenAI render from the photo the guest already submitted; throws the API's message. */
  async function requestRegeneration(entry: RosterEntry) {
    const response = await fetch(`/api/admin30910/roster/${entry.id}/regenerate`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!response.ok) throw new Error(await readError(response));
  }

  async function regenerate(entry: RosterEntry) {
    setBusyId(entry.id);
    setError(null);
    setConfirmRegenerateId(null);
    setNotice(`正在為 ${entry.name} 重新生成，約需 30–90 秒…`);
    try {
      await requestRegeneration(entry);
      setNotice(`${entry.name} 的似顏繪已生成完成，報到時即可領取。`);
    } catch (caught) {
      setNotice(null);
      setError(
        `${entry.name}：${caught instanceof Error ? caught.message : "重新生成失敗。"}`,
      );
    } finally {
      setBusyId(null);
      await reload();
    }
  }

  /**
   * One guest at a time: parallel renders would only hit OpenAI's rate limit,
   * and stopping at the first account problem saves the rest of the list.
   */
  async function regenerateAllFailed() {
    const queue = [...failed];
    setConfirmRegenerateAll(false);
    setError(null);
    let done = 0;
    const problems: string[] = [];
    for (const [index, entry] of queue.entries()) {
      setRegenerateProgress(`${index + 1}/${queue.length}`);
      setBusyId(entry.id);
      setNotice(`正在重新生成 ${entry.name}（${index + 1}/${queue.length}）…`);
      try {
        await requestRegeneration(entry);
        done += 1;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "重新生成失敗。";
        problems.push(`${entry.name}：${message}`);
        if (/額度|上限/.test(message)) break;
      }
    }
    setBusyId(null);
    setRegenerateProgress(null);
    setNotice(`已完成 ${done}/${queue.length} 位。`);
    if (problems.length) setError(problems.join("；"));
    await reload();
  }

  async function revertAdjusted(entry: RosterEntry) {
    setBusyId(entry.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin30910/roster/${entry.id}/portrait`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(`已將 ${entry.name} 的似顏繪還原為原始生成圖。`);
      setConfirmRevertId(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法還原作品。");
    } finally {
      setBusyId(null);
    }
  }

  async function setCheckedIn(entry: RosterEntry, checkedIn: boolean) {
    setBusyId(entry.id);
    setError(null);
    try {
      const response = await fetch(`/api/admin30910/roster/${entry.id}/check-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedIn }),
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(checkedIn ? `已為 ${entry.name} 報到。` : `已取消 ${entry.name} 的報到。`);
      setConfirmUndoId(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "報到更新失敗。");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="admin-panel admin-roster admin-check-in">
      <header className="admin-panel-header">
        <div>
          <p>活動當天</p>
          <h2>報到管理</h2>
        </div>
        <span>
          {refreshedAt ? `${formatTaipeiTime(refreshedAt)} 更新・每 10 秒` : "讀取中"}
        </span>
      </header>

      <div className="admin-check-in-top">
        <button
          type="button"
          className={`admin-check-in-switch${settings?.open ? " is-open" : ""}`}
          role="switch"
          aria-checked={settings?.open ?? false}
          disabled={!settings || toggling}
          onClick={() => void toggleOpen()}
        >
          <i aria-hidden="true" />
          <span>
            <strong>{settings?.open ? "報到開放中" : "報到未開放"}</strong>
            <small>
              {settings?.open ? "來賓可在 /check-in 自助報到" : "開啟後來賓才能報到"}
            </small>
          </span>
        </button>

        <div className="admin-metrics admin-check-in-metrics">
          <div className="admin-metric">
            <span>已報到</span>
            <strong>
              {arrived.length}/{entries.length}
            </strong>
            <small>報到率 {rate}%</small>
          </div>
          <div className="admin-metric">
            <span>未報到</span>
            <strong>{entries.length - arrived.length}</strong>
            <small>尚未抵達</small>
          </div>
          <div className="admin-metric">
            <span>似顏繪</span>
            <strong>{portraits.length}</strong>
            <small>已完成作品</small>
          </div>
        </div>
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept={ADJUSTED_MIME_TYPES.join(",")}
        hidden
        aria-label="選擇調整後的似顏繪"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadAdjusted(file);
          else uploadTargetRef.current = null;
        }}
      />

      {(error ?? loadError) && <p className="admin-banner">{error ?? loadError}</p>}
      {notice && !error && !loadError && <p className="admin-batch-hint admin-roster-notice">{notice}</p>}

      <div className="admin-roster-toolbar">
        <div className="admin-segmented" role="group" aria-label="報到篩選">
          {(
            [
              ["all", `全部 ${entries.length}`],
              ["arrived", `已報到 ${arrived.length}`],
              ["waiting", `未報到 ${entries.length - arrived.length}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              className={filter === value ? "is-active" : undefined}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋姓名、手機、座位"
          aria-label="搜尋報到名單"
        />
        <button
          type="button"
          className="secondary-button"
          disabled={!entries.length}
          onClick={() => downloadCsv(entries)}
        >
          匯出 CSV
        </button>
        {(failed.length > 0 || regenerateProgress) &&
          (regenerateProgress ? (
            <span className="admin-regenerate-progress" role="status">
              重新生成中 {regenerateProgress}
            </span>
          ) : confirmRegenerateAll ? (
            <>
              <button
                type="button"
                className="primary-button"
                onClick={() => void regenerateAllFailed()}
              >
                確定生成 {failed.length} 位（使用 OpenAI 額度）
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setConfirmRegenerateAll(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={Boolean(busyId)}
              title="用來賓已上傳的照片重新生成，逐位處理"
              onClick={() => setConfirmRegenerateAll(true)}
            >
              重新生成失敗的 {failed.length} 位
            </button>
          ))}
      </div>

      {loading ? (
        <p className="admin-empty">讀取報到資料中…</p>
      ) : visible.length === 0 ? (
        <p className="admin-empty">
          {entries.length ? "沒有符合的來賓。" : "名單是空的，請先在名單管理匯入。"}
        </p>
      ) : (
        <ul className="admin-roster-list">
          {visible.map((entry) => (
            <li key={entry.id} className="admin-roster-row admin-check-in-row">
              <div className="admin-roster-main">
                <span className="admin-roster-seat">{entry.seat || "—"}</span>
                <strong>{entry.name}</strong>
                {entry.role && <em>{entry.role}</em>}
              </div>
              <span
                className={`admin-check-in-chip${entry.checkedInAt ? " is-arrived" : ""}`}
              >
                {entry.checkedInAt
                  ? `已報到 ${formatTaipeiTime(entry.checkedInAt)}・${
                      entry.checkInSource === "admin" ? "工作人員" : "自助"
                    }`
                  : "未報到"}
              </span>
              <span
                className={`admin-check-in-chip admin-portrait-${entry.portraitStatus ?? "none"}`}
              >
                似顏繪：{portraitLabel(entry)}
              </span>
              {entry.portraitStatus === "complete" && entry.portraitAdjustedAt && (
                <span className="admin-check-in-chip is-adjusted">
                  已調整 {formatTaipeiTime(entry.portraitAdjustedAt)}
                </span>
              )}
              <span
                className={`admin-check-in-chip${hasSubmittedPhoto(entry) ? " is-submitted" : ""}`}
              >
                {hasSubmittedPhoto(entry) ? "已上傳照片" : "可上傳照片"}
              </span>
              <div className="admin-roster-actions">
                {entry.portraitStatus === "complete" && entry.portraitSessionId && (
                  <>
                    <a
                      href={`/api/admin30910/sessions/${entry.portraitSessionId}/image?kind=result&v=${encodeURIComponent(entry.portraitAdjustedAt ?? "generated")}`}
                      target="_blank"
                      rel="noreferrer"
                      title="來賓目前會收到的作品（壓縮預覽）"
                    >
                      查看作品
                    </a>
                    <a
                      href={`/api/admin30910/sessions/${entry.portraitSessionId}/image?kind=result&original=1`}
                      title="下載來賓會收到的原尺寸檔案"
                    >
                      下載原圖
                    </a>
                    <button
                      type="button"
                      disabled={busyId === entry.id}
                      title="上傳修圖後的版本，取代來賓收到的作品"
                      onClick={() => chooseAdjustedImage(entry)}
                    >
                      {entry.portraitAdjustedAt ? "重新上傳調整版" : "上傳調整版"}
                    </button>
                    {entry.portraitAdjustedAt &&
                      (confirmRevertId === entry.id ? (
                        <>
                          <button
                            type="button"
                            className="is-danger"
                            disabled={busyId === entry.id}
                            onClick={() => void revertAdjusted(entry)}
                          >
                            確定還原
                          </button>
                          <button type="button" onClick={() => setConfirmRevertId(null)}>
                            不用
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          title="改回原始生成的作品"
                          onClick={() => setConfirmRevertId(entry.id)}
                        >
                          還原原圖
                        </button>
                      ))}
                  </>
                )}
                {entry.portraitStatus === "failed" &&
                  entry.portraitSessionId &&
                  (confirmRegenerateId === entry.id ? (
                    <>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busyId === entry.id || Boolean(regenerateProgress)}
                        onClick={() => void regenerate(entry)}
                      >
                        確定生成
                      </button>
                      <button type="button" onClick={() => setConfirmRegenerateId(null)}>
                        不用
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busyId === entry.id || Boolean(regenerateProgress)}
                      title="用來賓已上傳的照片重新生成（會使用 OpenAI 額度）"
                      onClick={() => setConfirmRegenerateId(entry.id)}
                    >
                      {busyId === entry.id ? "生成中…" : "重新生成"}
                    </button>
                  ))}
                {hasSubmittedPhoto(entry) &&
                  (confirmResubmitId === entry.id ? (
                    <>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busyId === entry.id}
                        onClick={() => void allowResubmit(entry)}
                      >
                        確定開放
                      </button>
                      <button type="button" onClick={() => setConfirmResubmitId(null)}>
                        不用
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      title="每位來賓限上傳一次；開放後可再上傳一張（會再生成一次）"
                      onClick={() => setConfirmResubmitId(entry.id)}
                    >
                      允許重新上傳
                    </button>
                  ))}
                {!entry.checkedInAt ? (
                  <button
                    type="button"
                    disabled={busyId === entry.id}
                    onClick={() => void setCheckedIn(entry, true)}
                  >
                    手動報到
                  </button>
                ) : confirmUndoId === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="is-danger"
                      disabled={busyId === entry.id}
                      onClick={() => void setCheckedIn(entry, false)}
                    >
                      確定取消
                    </button>
                    <button type="button" onClick={() => setConfirmUndoId(null)}>
                      保留
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={() => setConfirmUndoId(entry.id)}>
                    取消報到
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

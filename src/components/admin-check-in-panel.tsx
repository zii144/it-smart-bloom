"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildCheckInCsv, portraitLabel } from "@/lib/check-in-csv";
import { formatTaipeiTime } from "@/lib/event-info";
import type { RosterEntry } from "@/lib/roster";

type CheckInSettings = { open: boolean; updatedAt: string | null };
type Filter = "all" | "arrived" | "waiting";

/** Polling is only for the live arrival board; each read costs one roster scan. */
const REFRESH_MS = 10_000;

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
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmUndoId, setConfirmUndoId] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const applyPayload = useCallback((payload: RosterPayload) => {
    setEntries(payload.entries);
    setSettings(payload.checkIn);
    setError(null);
    setLoading(false);
    setRefreshedAt(new Date().toISOString());
  }, []);

  const showLoadError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "無法讀取報到資料。");
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

      {error && <p className="admin-banner">{error}</p>}
      {notice && !error && <p className="admin-batch-hint admin-roster-notice">{notice}</p>}

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
              <div className="admin-roster-actions">
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

"use client";

import { useEffect, useState } from "react";
import {
  RESET_CATEGORIES,
  RESET_CONFIRMATION,
  type ResetCategory,
  type ResetCounts,
  type ResetLog,
} from "@/lib/data-reset-shared";
import { formatTaipeiShort } from "@/lib/event-info";

type Preview = {
  environment: "emulator" | "live";
  counts: { roster: number; checkedIn: number; sessions: number; usage: number };
  lastReset: ResetLog | null;
};

const COUNT_LABELS: Record<keyof ResetCounts, string> = {
  rosterEntries: "來賓",
  checkInsCleared: "報到清除",
  sessions: "創作紀錄",
  identities: "身分紀錄",
  storageFiles: "雲端檔案",
  localSessions: "本機暫存",
  portraitLinksCleared: "作品狀態清除",
  usageDays: "用量天數",
};

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error || `操作失敗（${response.status}）`;
}

async function fetchPreview(): Promise<Preview> {
  const response = await fetch("/api/admin30910/reset", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as Preview;
}

function describeCounts(counts: ResetCounts) {
  return (Object.entries(counts) as [keyof ResetCounts, number][])
    .map(([key, value]) => `${COUNT_LABELS[key]} ${value}`)
    .join("・");
}

/** Saves the backup through the browser before anything is deleted. */
async function downloadBackup(categories: ResetCategory[]) {
  const response = await fetch(
    `/api/admin30910/reset/backup?categories=${categories.join(",")}`,
    { cache: "no-store", credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(`備份失敗：${await readError(response)}`);
  const blob = await response.blob();
  const name =
    response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ??
    "bloom-backup.json";
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return name;
}

export function AdminResetPanel({
  active,
  onReset,
}: {
  active: boolean;
  /** Lets the other tabs reload after their data changed underneath them. */
  onReset?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<ResetCategory>>(new Set());
  const [phrase, setPhrase] = useState("");
  const [stage, setStage] = useState<"idle" | "backup" | "reset">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchPreview().then(
      (next) => {
        if (!cancelled) setPreview(next);
      },
      (caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "無法讀取資料概況。");
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, refreshKey]);

  const rosterSelected = selected.has("roster");
  // Deleting the guest list already removes their check-ins.
  const effective = [...selected].filter(
    (key) => !(key === "checkIns" && rosterSelected),
  );
  const ready =
    effective.length > 0 && phrase.trim() === RESET_CONFIRMATION && stage === "idle";
  const live = preview?.environment === "live";

  function countFor(key: ResetCategory) {
    if (!preview) return "";
    const { counts } = preview;
    if (key === "roster") return `${counts.roster} 位來賓`;
    if (key === "checkIns") return `${counts.checkedIn} 位已報到`;
    if (key === "portraits") return `${counts.sessions} 筆創作`;
    return `${counts.usage} 天`;
  }

  function toggle(key: ResetCategory) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setResult(null);
  }

  async function run() {
    if (!ready) return;
    setError(null);
    setResult(null);
    try {
      setStage("backup");
      const backupName = await downloadBackup(effective);

      setStage("reset");
      const response = await fetch("/api/admin30910/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: effective, confirmation: phrase.trim() }),
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      const { reset } = (await response.json()) as { reset: ResetLog };
      setResult(`已重置。備份：${backupName}。${describeCounts(reset.counts)}`);
      setSelected(new Set());
      setPhrase("");
      setRefreshKey((key) => key + 1);
      onReset?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重置失敗。");
    } finally {
      setStage("idle");
    }
  }

  return (
    <section className="admin-panel admin-roster admin-reset">
      <header className="admin-panel-header">
        <div>
          <p>危險操作</p>
          <h2>資料重置</h2>
        </div>
        {preview && (
          <span className={`admin-reset-env${live ? " is-live" : ""}`}>
            {live ? "正式環境・會刪除真實資料" : "模擬器・本機測試資料"}
          </span>
        )}
      </header>

      <p className="admin-batch-hint">
        重置前會先下載一份 JSON 備份（雲端照片檔案不含在備份中）。每次重置都會留下紀錄。
        {preview?.lastReset
          ? ` 上次重置：${formatTaipeiShort(preview.lastReset.at)}（${preview.lastReset.categories
              .map((key) => RESET_CATEGORIES.find((category) => category.key === key)?.label ?? key)
              .join("、")}）`
          : ""}
      </p>

      <fieldset className="admin-reset-options" disabled={stage !== "idle"}>
        <legend>選擇要重置的資料</legend>
        {RESET_CATEGORIES.map((category) => {
          const implied = category.key === "checkIns" && rosterSelected;
          return (
            <label
              key={category.key}
              className={`admin-reset-option${selected.has(category.key) || implied ? " is-selected" : ""}`}
            >
              <input
                type="checkbox"
                checked={selected.has(category.key) || implied}
                disabled={implied}
                onChange={() => toggle(category.key)}
              />
              <span>
                <strong>
                  {category.label}
                  <em>{countFor(category.key)}</em>
                </strong>
                <small>{implied ? "刪除名單時一併清除。" : category.description}</small>
              </span>
            </label>
          );
        })}
      </fieldset>

      <label className="admin-reset-confirm">
        <span>
          輸入「{RESET_CONFIRMATION}」以啟用按鈕
        </span>
        <input
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          placeholder={RESET_CONFIRMATION}
          autoComplete="off"
          disabled={stage !== "idle"}
        />
      </label>

      {error && <p className="admin-banner">{error}</p>}
      {result && !error && <p className="admin-batch-hint admin-roster-notice">{result}</p>}

      <div className="admin-batch-actions">
        <button
          type="button"
          className="primary-button admin-reset-button"
          disabled={!ready}
          onClick={() => void run()}
        >
          {stage === "backup"
            ? "下載備份中…"
            : stage === "reset"
              ? "重置中…"
              : "下載備份並重置"}
        </button>
      </div>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ROSTER_NUMBER_FIELDS,
  ROSTER_TEXT_FIELDS,
  type RosterEntry,
  type RosterImportSummary,
} from "@/lib/roster";

type RosterImportMeta = {
  importedAt: string;
  sheet: string;
  created: number;
  updated: number;
  unchanged: number;
  issues: number;
};

/** Text-only form state; the server owns validation and normalization. */
type EntryDraft = Record<string, string> & { name: string; mobile: string; extra: string };

const PAGE_SIZE = 40;

function emptyDraft(): EntryDraft {
  const draft: EntryDraft = { name: "", mobile: "", extra: "" };
  for (const field of ROSTER_TEXT_FIELDS) draft[field.key] = "";
  for (const field of ROSTER_NUMBER_FIELDS) draft[field.key] = "";
  return draft;
}

function draftFromEntry(entry: RosterEntry): EntryDraft {
  const draft = emptyDraft();
  draft.name = entry.name;
  draft.mobile = entry.mobile ?? "";
  for (const field of ROSTER_TEXT_FIELDS) draft[field.key] = entry[field.key] ?? "";
  for (const field of ROSTER_NUMBER_FIELDS) {
    const value = entry[field.key];
    draft[field.key] = value === null || value === undefined ? "" : String(value);
  }
  draft.extra = Object.entries(entry.extra ?? {})
    .map(([key, value]) => `${key}：${value}`)
    .join("\n");
  return draft;
}

/** `欄位：值` per line (half- or full-width colon) back into an object. */
function parseExtra(text: string) {
  const extra: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/);
    if (match && match[1] && match[2]) extra[match[1]] = match[2];
  }
  return extra;
}

function bodyFromDraft(draft: EntryDraft) {
  const body: Record<string, unknown> = {
    name: draft.name,
    mobile: draft.mobile,
    extra: parseExtra(draft.extra),
  };
  for (const field of ROSTER_TEXT_FIELDS) body[field.key] = draft[field.key];
  for (const field of ROSTER_NUMBER_FIELDS) body[field.key] = draft[field.key];
  return body;
}

function formatWhen(value: string) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || `操作失敗（${response.status}）`;
}

type RosterPayload = {
  entries: RosterEntry[];
  lastImport: RosterImportMeta | null;
};

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
  const haystack = [
    entry.name,
    entry.mobile ?? "",
    entry.seat,
    entry.role,
    entry.email,
    entry.note,
  ]
    .join(" ")
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

function EntryForm({
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  error,
}: {
  draft: EntryDraft;
  onChange: (draft: EntryDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
  busy: boolean;
  /** Shown beside the buttons: a tall form pushes the panel banner out of view. */
  error: string | null;
}) {
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value });

  return (
    <form
      className="admin-roster-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label>
        <span>姓名 *</span>
        <input
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
          required
          maxLength={60}
        />
      </label>
      <label>
        <span>手機</span>
        <input
          value={draft.mobile}
          onChange={(event) => set("mobile", event.target.value)}
          inputMode="tel"
          placeholder="0912345678（空白則無法比對）"
        />
      </label>
      {ROSTER_TEXT_FIELDS.map((field) => (
        <label
          key={field.key}
          className={field.key === "address" || field.key === "note" ? "is-wide" : undefined}
        >
          <span>{field.label}</span>
          <input
            value={draft[field.key]}
            onChange={(event) => set(field.key, event.target.value)}
            maxLength={500}
          />
        </label>
      ))}
      {ROSTER_NUMBER_FIELDS.map((field) => (
        <label key={field.key}>
          <span>{field.label}</span>
          <input
            value={draft[field.key]}
            onChange={(event) => set(field.key, event.target.value)}
            inputMode="decimal"
          />
        </label>
      ))}
      <label className="is-wide">
        <span>其他欄位（每行「欄位：值」）</span>
        <textarea
          value={draft.extra}
          onChange={(event) => set("extra", event.target.value)}
          rows={2}
        />
      </label>
      {error && (
        <p className="admin-roster-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-roster-form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? "儲存中…" : submitLabel}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
          取消
        </button>
      </div>
    </form>
  );
}

function ImportSummary({ summary }: { summary: RosterImportSummary }) {
  const skipped = summary.issues.filter((issue) => issue.level === "skipped");
  const warnings = summary.issues.filter((issue) => issue.level === "warning");

  return (
    <div className="admin-roster-summary">
      <p>
        工作表「{summary.sheet}」：
        <strong>新增 {summary.creates.length}</strong> ·{" "}
        <strong>更新 {summary.updates.length}</strong> · 不變 {summary.unchanged}
        {skipped.length ? ` · 略過 ${skipped.length}` : ""}
        {warnings.length ? ` · 提醒 ${warnings.length}` : ""}
      </p>
      {summary.ignoredColumns.length > 0 && (
        <p className="admin-batch-hint">
          不匯入的敏感欄位：{summary.ignoredColumns.join("、")}
        </p>
      )}
      {summary.updates.length > 0 && (
        <details>
          <summary>將更新的人（{summary.updates.length}）</summary>
          <ul>
            {summary.updates.map((update) => (
              <li key={`u-${update.row}`}>
                第 {update.row} 列 {update.name}：{update.changes.join("、")}
              </li>
            ))}
          </ul>
        </details>
      )}
      {summary.creates.length > 0 && (
        <details>
          <summary>將新增的人（{summary.creates.length}）</summary>
          <ul>
            {summary.creates.map((create) => (
              <li key={`c-${create.row}`}>
                第 {create.row} 列 {create.seat ? `${create.seat} ` : ""}
                {create.name}
                {create.mobile ? "" : "（無手機）"}
              </li>
            ))}
          </ul>
        </details>
      )}
      {summary.issues.length > 0 && (
        <details open={skipped.length > 0}>
          <summary>需要留意（{summary.issues.length}）</summary>
          <ul>
            {summary.issues.map((issue, index) => (
              <li
                key={`i-${issue.row}-${index}`}
                className={issue.level === "skipped" ? "is-skipped" : undefined}
              >
                第 {issue.row} 列{issue.name ? ` ${issue.name}` : ""}：{issue.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function AdminRosterPanel({
  onEntriesChange,
}: {
  onEntriesChange?: (entries: RosterEntry[]) => void;
}) {
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [lastImport, setLastImport] = useState<RosterImportMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlyUnmatchable, setOnlyUnmatchable] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RosterImportSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EntryDraft>(emptyDraft);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const applyPayload = useCallback(
    (payload: RosterPayload) => {
      setEntries(payload.entries);
      setLastImport(payload.lastImport);
      setError(null);
      setLoading(false);
      onEntriesChange?.(payload.entries);
    },
    [onEntriesChange],
  );

  const showLoadError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "無法讀取名單。");
    setLoading(false);
  }, []);

  /** Re-reads after a write; a failed refresh is shown, not thrown. */
  const reload = useCallback(async () => {
    try {
      applyPayload(await fetchRoster());
    } catch (caught) {
      showLoadError(caught);
    }
  }, [applyPayload, showLoadError]);

  useEffect(() => {
    let cancelled = false;
    fetchRoster().then(
      (payload) => {
        if (!cancelled) applyPayload(payload);
      },
      (caught) => {
        if (!cancelled) showLoadError(caught);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [applyPayload, showLoadError]);

  const formOpen = adding || editingId !== null;
  const unmatchableCount = entries.filter((entry) => !entry.matchKey).length;
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (!onlyUnmatchable || !entry.matchKey) && matchesQuery(entry, query.trim()),
      ),
    [entries, onlyUnmatchable, query],
  );

  async function runImport(file: File, mode: "preview" | "apply") {
    setImporting(true);
    setNotice(null);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      const response = await fetch("/api/admin30910/roster/import", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      const summary = (await response.json()) as RosterImportSummary;
      if (mode === "preview") {
        setPreview(summary);
      } else {
        setPreview(null);
        setImportFile(null);
        setNotice(
          `匯入完成：新增 ${summary.creates.length}、更新 ${summary.updates.length}、不變 ${summary.unchanged}。`,
        );
        await reload();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "匯入失敗。");
      if (mode === "preview") setImportFile(null);
    } finally {
      setImporting(false);
    }
  }

  async function saveEntry() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        adding ? "/api/admin30910/roster" : `/api/admin30910/roster/${editingId}`,
        {
          method: adding ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyFromDraft(draft)),
          credentials: "same-origin",
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      setNotice(adding ? `已新增 ${draft.name.trim()}。` : `已更新 ${draft.name.trim()}。`);
      setAdding(false);
      setEditingId(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "儲存失敗。");
    } finally {
      setSaving(false);
    }
  }

  async function deleteEntry(entry: RosterEntry) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin30910/roster/${entry.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      setNotice(`已刪除 ${entry.name}。`);
      setConfirmDeleteId(null);
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "刪除失敗。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="admin-panel admin-roster">
      <header className="admin-panel-header">
        <div>
          <p>報名名單</p>
          <h2>名單管理</h2>
        </div>
        <span>
          {entries.length} 人
          {unmatchableCount ? ` · ${unmatchableCount} 人無手機無法比對` : ""}
        </span>
      </header>

      <div className="admin-roster-import">
        <label className="admin-batch-drop">
          <input
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={importing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setImportFile(file);
              setPreview(null);
              void runImport(file, "preview");
            }}
          />
          <strong>{importing && !preview ? "讀取中…" : "從 Excel 匯入名單"}</strong>
          <small>
            .xlsx，需有「姓名」與「手機」欄位。先預覽再確認；只新增與更新，不會刪除任何人，空白儲存格不會清掉既有資料。
            {lastImport
              ? ` 上次匯入：${formatWhen(lastImport.importedAt)}（新增 ${lastImport.created}、更新 ${lastImport.updated}）`
              : ""}
          </small>
        </label>

        {preview && importFile && (
          <>
            <ImportSummary summary={preview} />
            <div className="admin-batch-actions">
              <button
                type="button"
                className="primary-button"
                disabled={
                  importing || (!preview.creates.length && !preview.updates.length)
                }
                onClick={() => void runImport(importFile, "apply")}
              >
                {importing ? "匯入中…" : "確認匯入"}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={importing}
                onClick={() => {
                  setPreview(null);
                  setImportFile(null);
                }}
              >
                取消
              </button>
            </div>
          </>
        )}
      </div>

      {error && !formOpen && <p className="admin-banner">{error}</p>}
      {notice && !error && <p className="admin-batch-hint admin-roster-notice">{notice}</p>}

      <div className="admin-roster-toolbar">
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisible(PAGE_SIZE);
          }}
          placeholder="搜尋姓名、手機、座位、身分、備註"
          aria-label="搜尋名單"
        />
        <label className="admin-batch-toggle">
          <input
            type="checkbox"
            checked={onlyUnmatchable}
            onChange={(event) => setOnlyUnmatchable(event.target.checked)}
          />
          <span>只看無手機</span>
        </label>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            setAdding(true);
            setEditingId(null);
            setError(null);
            setDraft(emptyDraft());
          }}
        >
          新增一人
        </button>
      </div>

      {adding && (
        <EntryForm
          draft={draft}
          onChange={setDraft}
          onSubmit={() => void saveEntry()}
          onCancel={() => {
            setAdding(false);
            setError(null);
          }}
          submitLabel="新增"
          busy={saving}
          error={error}
        />
      )}

      {loading ? (
        <p className="admin-empty">讀取名單中…</p>
      ) : filtered.length === 0 ? (
        <p className="admin-empty">
          {entries.length ? "沒有符合的資料。" : "名單是空的，請先從 Excel 匯入。"}
        </p>
      ) : (
        <ul className="admin-roster-list">
          {filtered.slice(0, visible).map((entry) => (
            <li key={entry.id} className="admin-roster-row">
              {editingId === entry.id ? (
                <EntryForm
                  draft={draft}
                  onChange={setDraft}
                  onSubmit={() => void saveEntry()}
                  onCancel={() => {
                    setEditingId(null);
                    setError(null);
                  }}
                  submitLabel="儲存"
                  busy={saving}
                  error={error}
                />
              ) : (
                <>
                  <div className="admin-roster-main">
                    <span className="admin-roster-seat">{entry.seat || "—"}</span>
                    <strong>{entry.name}</strong>
                    <span className={entry.mobile ? undefined : "admin-roster-missing"}>
                      {entry.mobile ?? "無手機"}
                    </span>
                    {entry.role && <em>{entry.role}</em>}
                  </div>
                  <div className="admin-roster-meta">
                    {entry.email && <span>{entry.email}</span>}
                    {entry.note && <span>備註：{entry.note}</span>}
                    {entry.vest && <span>背心 {entry.vest}</span>}
                    {entry.mealGroup && <span>飯友 {entry.mealGroup}</span>}
                    {entry.mentorSubsidy !== null && entry.mentorSubsidy !== undefined && (
                      <span>導師補助 {entry.mentorSubsidy}</span>
                    )}
                    {entry.teamGuest !== null && entry.teamGuest !== undefined && (
                      <span>團隊貴賓 {entry.teamGuest}</span>
                    )}
                  </div>
                  <div className="admin-roster-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(entry.id);
                        setAdding(false);
                        setError(null);
                        setConfirmDeleteId(null);
                        setDraft(draftFromEntry(entry));
                      }}
                    >
                      編輯
                    </button>
                    {confirmDeleteId === entry.id ? (
                      <>
                        <button
                          type="button"
                          className="is-danger"
                          disabled={saving}
                          onClick={() => void deleteEntry(entry)}
                        >
                          確定刪除
                        </button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)}>
                          取消
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setConfirmDeleteId(entry.id)}>
                        刪除
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {filtered.length > visible && (
        <footer className="admin-pagination">
          <button type="button" onClick={() => setVisible((count) => count + PAGE_SIZE)}>
            顯示更多（還有 {filtered.length - visible} 筆）
          </button>
        </footer>
      )}
    </section>
  );
}

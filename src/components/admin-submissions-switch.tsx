"use client";

import { useEffect, useState } from "react";
import { formatTaipeiShort } from "@/lib/event-info";

type SubmissionSettings = { open: boolean; updatedAt: string | null };

async function readError(response: Response) {
  const payload = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return payload?.error || `操作失敗（${response.status}）`;
}

/** Opens or closes the booth's 欣然赴約, i.e. whether guests may still submit photos. */
export function AdminSubmissionsSwitch() {
  const [settings, setSettings] = useState<SubmissionSettings | null>(null);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin30910/submissions", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return (await response.json()) as { submissions: SubmissionSettings };
      })
      .then(
        (payload) => {
          if (!cancelled) setSettings(payload.submissions);
        },
        (caught) => {
          if (!cancelled) {
            setError(caught instanceof Error ? caught.message : "無法讀取收件狀態。");
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle() {
    if (!settings) return;
    setToggling(true);
    setError(null);
    try {
      const response = await fetch("/api/admin30910/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ open: !settings.open }),
        credentials: "same-origin",
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { submissions: SubmissionSettings };
      setSettings(payload.submissions);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "無法切換收件狀態。");
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="admin-submissions">
      <button
        type="button"
        className={`admin-check-in-switch${settings?.open ? " is-open" : ""}`}
        role="switch"
        aria-checked={settings?.open ?? false}
        disabled={!settings || toggling}
        onClick={() => void toggle()}
      >
        <i aria-hidden="true" />
        <span>
          <strong>
            {!settings ? "讀取收件狀態…" : settings.open ? "照片收件中" : "照片已截止收件"}
          </strong>
          <small>
            {settings?.open
              ? "邀請卡顯示「欣然赴約」，來賓可上傳照片"
              : "邀請卡顯示截止訊息，來賓無法再上傳照片"}
            {settings?.updatedAt ? `・${formatTaipeiShort(settings.updatedAt)} 更新` : ""}
          </small>
        </span>
      </button>
      {error && <p className="admin-banner">{error}</p>}
    </div>
  );
}

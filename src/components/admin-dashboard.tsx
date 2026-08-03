"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AdminBatchPanel } from "@/components/admin-batch-panel";
import { BloomMark } from "@/components/brand";
import type { ImageGenerationOptions } from "@/lib/image-options";

export type AdminSessionRow = {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  identity: string | null;
  avatarRequestStatus: string | null;
  fakeGenerate: boolean | null;
  source: string | null;
  error: string | null;
  inputUrl: string | null;
  resultUrl: string | null;
};

export type AdminDashboardPayload = {
  health: {
    firebaseConfigured: boolean;
    firebaseEmulator: boolean;
    firestoreHost: string | null;
    storageHost: string | null;
    vercelEnv: string | null;
    nodeEnv: string | null;
    imageTuning: boolean;
    hasOpenAiKey: boolean;
    hasOpenAiPrompt: boolean;
    hasRoadTeacherUrl: boolean;
    hasRoadTeacherKey: boolean;
    dataDir: string;
  };
  imageDefaults: ImageGenerationOptions;
  localSessions: AdminSessionRow[];
  archiveSessions: AdminSessionRow[];
  archiveError: string | null;
};

function Chip({
  label,
  on,
  detail,
}: {
  label: string;
  on?: boolean;
  detail?: string | null;
}) {
  return (
    <span className={`admin-chip ${on ? "admin-chip-on" : "admin-chip-off"}`}>
      <strong>{label}</strong>
      {detail ? <em>{detail}</em> : <em>{on ? "已設定" : "未設定"}</em>}
    </span>
  );
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

function localizeStatus(status: string) {
  const labels: Record<string, string> = {
    ready: "等待中",
    generating: "生成中",
    complete: "已完成",
    failed: "失敗",
    idle: "尚未送出",
    success: "成功",
  };
  return labels[status] ?? status;
}

function localizeIdentity(identity: string | null) {
  if (!identity) return "尚未認領";
  if (identity.startsWith("mobile:")) {
    return `手機：${identity.slice("mobile:".length)}`;
  }
  if (identity.startsWith("lineId:")) {
    return `LINE ID：${identity.slice("lineId:".length)}`;
  }
  return identity;
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function HealthCard({
  title,
  state,
  healthy,
  children,
}: {
  title: string;
  state: string;
  healthy: boolean;
  children: ReactNode;
}) {
  return (
    <article className="admin-health-card">
      <div className="admin-health-card-title">
        <span className={healthy ? "is-healthy" : "is-warning"} />
        <strong>{title}</strong>
        <em>{state}</em>
      </div>
      <div className="admin-health-card-detail">{children}</div>
    </article>
  );
}

const ROWS_PER_PAGE = 4;

function FlipPortrait({
  resultUrl,
  inputUrl,
}: {
  resultUrl: string | null;
  inputUrl: string | null;
}) {
  const [isFlipped, setIsFlipped] = useState(false);
  const frontUrl = resultUrl ?? inputUrl;
  const backUrl = resultUrl && inputUrl ? inputUrl : null;
  const canFlip = Boolean(resultUrl && inputUrl);

  if (!frontUrl) return null;

  const faces = (
    <span className="admin-flip-inner">
      <span className="admin-flip-face admin-flip-front">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={frontUrl} alt="" />
      </span>
      {backUrl ? (
        <span className="admin-flip-face admin-flip-back">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={backUrl} alt="" />
        </span>
      ) : null}
    </span>
  );

  if (!canFlip) {
    return <div className="admin-flip-portrait">{faces}</div>;
  }

  return (
    <button
      type="button"
      className={`admin-flip-portrait${isFlipped ? " is-flipped" : ""}`}
      onClick={() => setIsFlipped((current) => !current)}
      aria-label="點擊切換結果／原圖"
      aria-pressed={isFlipped}
    >
      {faces}
    </button>
  );
}

function SessionPanel({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: AdminSessionRow[];
  empty: string;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(
    safePage * ROWS_PER_PAGE,
    (safePage + 1) * ROWS_PER_PAGE,
  );

  return (
    <section className="admin-panel">
      <header className="admin-panel-header">
        <div>
          <p>資料來源</p>
          <h2>{title}</h2>
        </div>
        <span>{rows.length} 筆</span>
      </header>
      {rows.length === 0 ? (
        <p className="admin-empty">{empty}</p>
      ) : (
        <div className="admin-session-list">
          {visibleRows.map((row) => (
            <article className="admin-session-row" key={`${title}-${row.id}`}>
              <FlipPortrait resultUrl={row.resultUrl} inputUrl={row.inputUrl} />
              <div className="admin-session-body">
                <div className="admin-session-main">
                  <a href={`/s/${row.id}`} target="_blank" rel="noreferrer">
                    {row.id.slice(0, 12)}…
                  </a>
                  <span className={`admin-status admin-status-${row.status}`}>
                    {localizeStatus(row.status)}
                  </span>
                </div>
                <div className="admin-session-meta">
                  <span>{formatWhen(row.createdAt)}</span>
                  <span>
                    {row.source === "admin-batch"
                      ? "批次生成"
                      : localizeIdentity(row.identity)}
                  </span>
                  {row.fakeGenerate === true && <span>假生成</span>}
                  {row.avatarRequestStatus && (
                    <span>
                      大頭貼替換：{localizeStatus(row.avatarRequestStatus)}
                    </span>
                  )}
                </div>
                {row.error && <p className="admin-session-error">{row.error}</p>}
              </div>
            </article>
          ))}
        </div>
      )}
      {rows.length > ROWS_PER_PAGE && (
        <footer className="admin-pagination">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            disabled={safePage === 0}
          >
            上一頁
          </button>
          <span>
            {safePage + 1} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
            disabled={safePage === pageCount - 1}
          >
            下一頁
          </button>
        </footer>
      )}
    </section>
  );
}

function AdminChrome({
  note,
  children,
}: {
  note?: string;
  children: ReactNode;
}) {
  return (
    <main className="booth-shell admin-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <BloomMark />
        {note ? (
          <div className="privacy-note">
            <span className="privacy-dot" />
            {note}
          </div>
        ) : null}
      </header>

      <section className="admin-stage">{children}</section>

      <footer className="site-footer">
        <span>營運觀察・不對外公開</span>
        <span>資料僅供現場與開發除錯使用。</span>
      </footer>
    </main>
  );
}

export function AdminDashboard({
  initial,
}: {
  initial: AdminDashboardPayload;
}) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "batch">("overview");

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch("/api/admin30910", {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new Error(`Refresh failed (${response.status})`);
        }
        const payload = (await response.json()) as AdminDashboardPayload;
        if (!cancelled) {
          setData(payload);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Refresh failed",
          );
        }
      }
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const health = data.health;
  const allSessions = [...data.archiveSessions, ...data.localSessions];
  const completeCount = allSessions.filter(
    (session) => session.status === "complete",
  ).length;
  const failedCount = allSessions.filter(
    (session) => session.status === "failed",
  ).length;
  const openAiReady = health.hasOpenAiKey && health.hasOpenAiPrompt;
  const roadTeacherReady =
    health.hasRoadTeacherUrl && health.hasRoadTeacherKey;

  return (
    <AdminChrome>
      <nav className="admin-tabs" aria-label="管理頁功能">
        <button
          type="button"
          className={tab === "overview" ? "is-active" : undefined}
          aria-pressed={tab === "overview"}
          onClick={() => setTab("overview")}
        >
          現場總覽
        </button>
        <button
          type="button"
          className={tab === "batch" ? "is-active" : undefined}
          aria-pressed={tab === "batch"}
          onClick={() => setTab("batch")}
        >
          批次生成
        </button>
      </nav>

      {/* Both panels stay mounted: switching tabs mid-batch must not drop the queue. */}
      <div className="admin-tabpanel" hidden={tab !== "overview"}>
      <div className="admin-dashboard-top">
        <div className="stage-heading admin-heading">
          <p className="eyebrow">營運觀察</p>
          <h1>現場狀態總覽</h1>
          <p>
            即時掌握人像流程與服務狀態
            {error ? ` · 更新失敗：${error}` : " · 每 5 秒更新"}
          </p>
        </div>

        <section className="admin-metrics" aria-label="Session summary">
          <Metric
            label="Firestore"
            value={data.archiveSessions.length}
            hint="封存紀錄"
          />
          <Metric
            label="本機"
            value={data.localSessions.length}
            hint="本機紀錄"
          />
          <Metric label="已完成" value={completeCount} hint="完成紀錄" />
          <Metric label="失敗" value={failedCount} hint="需留意" />
        </section>
      </div>

      <section className="admin-health-grid" aria-label="Runtime health">
        <HealthCard
          title="Firebase"
          healthy={health.firebaseConfigured}
          state={
            health.firebaseConfigured
              ? health.firebaseEmulator
                ? "模擬器"
                : "正式環境"
              : "未連線"
          }
        >
          <Chip
            label="Firestore"
            on={Boolean(health.firestoreHost)}
            detail={health.firestoreHost ?? "雲端"}
          />
          <Chip
            label="Firebase Storage"
            on={Boolean(health.storageHost)}
            detail={health.storageHost ?? "雲端"}
          />
        </HealthCard>
        <HealthCard
          title="OpenAI"
          healthy={openAiReady}
          state={openAiReady ? "已就緒" : "設定不完整"}
        >
          <Chip label="API 金鑰" on={health.hasOpenAiKey} />
          <Chip label="提示詞" on={health.hasOpenAiPrompt} />
        </HealthCard>
        <HealthCard
          title="路老師"
          healthy={roadTeacherReady}
          state={roadTeacherReady ? "已就緒" : "尚未設定"}
        >
          <Chip label="API 端點" on={health.hasRoadTeacherUrl} />
          <Chip label="API 金鑰" on={health.hasRoadTeacherKey} />
        </HealthCard>
        <HealthCard
          title="執行環境"
          healthy
          state={
            health.vercelEnv === "production"
              ? "正式環境"
              : health.vercelEnv === "preview"
                ? "預覽環境"
                : "本機"
          }
        >
          <Chip
            label="模式"
            on
            detail={
              health.nodeEnv === "development"
                ? "開發"
                : health.nodeEnv === "production"
                  ? "正式"
                  : health.nodeEnv
            }
          />
          <Chip label="參數調校" on={health.imageTuning} />
        </HealthCard>
      </section>

      {data.archiveError ? (
        <p className="admin-banner">{data.archiveError}</p>
      ) : null}

      <div className="admin-panels-grid">
        <SessionPanel
          title="資料庫"
          rows={data.archiveSessions}
          empty="尚無封存資料（或 Firebase 未連線）。"
        />
        <SessionPanel
          title="本機磁碟"
          rows={data.localSessions}
          empty="尚無本機 session 資料夾。"
        />
      </div>
      </div>

      <div className="admin-tabpanel" hidden={tab !== "batch"}>
        <AdminBatchPanel
          defaults={data.imageDefaults}
          hasOpenAiKey={health.hasOpenAiKey}
          hasOpenAiPrompt={health.hasOpenAiPrompt}
          imageTuning={health.imageTuning}
        />
      </div>
    </AdminChrome>
  );
}

export function AdminLoginForm() {
  return (
    <AdminChrome note="需要管理員密鑰">
      <div className="admin-login-layout">
        <div className="stage-heading admin-heading">
          <p className="eyebrow">營運觀察</p>
          <h1>進入管理頁</h1>
        </div>

        <form
          className="admin-login-form"
          method="post"
          action="/api/admin30910/login"
        >
          <label className="admin-login-field">
            <span>管理員密鑰</span>
            <input
              type="password"
              name="key"
              autoComplete="current-password"
              required
              placeholder="ADMIN_DASHBOARD_SECRET"
            />
          </label>
          <button type="submit" className="primary-button">
            進入
          </button>
        </form>
      </div>
    </AdminChrome>
  );
}

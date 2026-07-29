"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { BloomMark } from "@/components/brand";
import { DevImageSettingsModal } from "@/components/dev-image-settings-modal";
import {
  FACEBOOK_SHARE_QUOTE,
  buildFacebookShareUrl,
} from "@/lib/facebook-share";
import type { ImageGenerationOptions } from "@/lib/image-options";

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22 12.07C22 6.48 17.52 2 11.93 2S1.86 6.48 1.86 12.07c0 5.02 3.66 9.18 8.44 9.93v-7.03H7.9v-2.9h2.4V9.84c0-2.37 1.4-3.68 3.55-3.68 1.03 0 2.1.18 2.1.18v2.32h-1.18c-1.17 0-1.53.73-1.53 1.48v1.78h2.61l-.42 2.9h-2.19V22c4.78-.75 8.44-4.91 8.44-9.93Z"
      />
    </svg>
  );
}

type SessionStatus = {
  id: string;
  status: "ready" | "generating" | "complete" | "failed";
  createdAt: string;
  startedAt: string | null;
  expiresAt: string;
  inputUrl: string;
  resultUrl: string | null;
  error: string | null;
  generationOptions?: ImageGenerationOptions | null;
  identity?: {
    kind: "lineId" | "mobile";
    value: string;
    claimedAt: string;
  } | null;
};

/** Measured end-to-end render time for gpt-image-2 medium, paces the bar. */
const EXPECTED_DURATION_MS = 120_000;
/** How long a session may sit at "ready" before the phone starts it itself. */
const AUTOSTART_GRACE_MS = 6_000;
/** Comfortably past a normal render, so a retry only appears on a real stall. */
const STALL_AFTER_MS = 240_000;
const POLL_INTERVAL_MS = 2_000;
/** Slower retry while the network is unreachable. */
const OFFLINE_RETRY_MS = 3_000;
/** How long to keep saying "connecting" before calling it a failure. */
const CONNECT_TIMEOUT_MS = 12_000;

const STAGE_HINTS: { until: number; label: string }[] = [
  { until: 12_000, label: "正在準備你的照片…" },
  { until: 35_000, label: "正在描繪輪廓線條…" },
  { until: 70_000, label: "正在暈染水彩色調…" },
  { until: 110_000, label: "正在加上光暈與細節…" },
  { until: Number.POSITIVE_INFINITY, label: "就快完成了，再等一下下…" },
];

/** Survives React Strict Mode remounts so we never double-fire generate. */
const generateInFlight = new Map<string, Promise<SessionStatus>>();

function withCacheBust(url: string | null) {
  if (!url) return null;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}t=${Date.now()}`;
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function postGenerate(
  id: string,
  options: ImageGenerationOptions | null,
  force: boolean,
): Promise<SessionStatus> {
  const existing = generateInFlight.get(id);
  if (existing && !force) return existing;

  const request = (async () => {
    const response = await fetch(`/api/sessions/${id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(options ?? {}), force }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "無法完成你的人像創作。");
    }
    return payload as SessionStatus;
  })();

  generateInFlight.set(id, request);
  try {
    return await request;
  } finally {
    if (generateInFlight.get(id) === request) {
      generateInFlight.delete(id);
    }
  }
}

export function SessionExperience({
  id,
  tuningEnabled,
}: {
  id: string;
  tuningEnabled: boolean;
}) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingForce, setPendingForce] = useState(false);
  const [lastOptions, setLastOptions] =
    useState<ImageGenerationOptions | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  const [lineId, setLineId] = useState("");
  const [mobile, setMobile] = useState("");
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);

  const applySession = useCallback((next: SessionStatus) => {
    setSession(next);
    setOffline(false);
    // Only real forward progress clears a failure. A poll that still reports
    // "ready" means nothing started, so wiping the error here would drop the
    // guest back onto a progress bar that is never going to finish.
    if (next.status === "generating" || next.status === "complete") {
      setError(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    let latestStatus: SessionStatus["status"] | null = null;
    // The fallback kick happens at most once per mount. If it does not take,
    // polling continues and the stall UI offers a deliberate manual retry
    // rather than us re-posting (and possibly re-billing) every two seconds.
    let fallbackStarted = false;

    function schedulePoll(delayMs: number) {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delayMs);
    }

    /**
     * A dropped request on hotel/venue Wi-Fi must not end the session: only an
     * explicit "gone" answer from the server is treated as final.
     */
    async function readStatus(): Promise<
      | { kind: "ok"; session: SessionStatus }
      | { kind: "gone"; message: string }
      | { kind: "offline" }
    > {
      let response: Response;
      try {
        response = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
      } catch {
        return { kind: "offline" };
      }

      let payload: Partial<SessionStatus> & { error?: string };
      try {
        payload = await response.json();
      } catch {
        return { kind: "offline" };
      }

      if (!response.ok) {
        return {
          kind: "gone",
          message: payload.error || "此連結目前無法使用。",
        };
      }

      return { kind: "ok", session: payload as SessionStatus };
    }

    async function poll() {
      const result = await readStatus();
      if (!active) return;

      if (result.kind === "offline") {
        setOffline(true);
        schedulePoll(OFFLINE_RETRY_MS);
        return;
      }

      if (result.kind === "gone") {
        setError(result.message);
        return;
      }

      const next = result.session;
      latestStatus = next.status;
      applySession(next);

      if (next.status === "complete" || next.status === "failed") return;

      // The server starts generation when the booth creates the session.
      // If that never happened, the phone starts it after a short grace.
      const waitingTooLong =
        Date.now() - Date.parse(next.createdAt) > AUTOSTART_GRACE_MS;
      const needsOptionsFirst = tuningEnabled && !next.generationOptions;

      if (
        next.status === "ready" &&
        waitingTooLong &&
        !needsOptionsFirst &&
        !fallbackStarted &&
        !generateInFlight.has(id)
      ) {
        fallbackStarted = true;
        void kickGenerate(next.generationOptions ?? null, false);
      }

      schedulePoll(POLL_INTERVAL_MS);
    }

    async function kickGenerate(
      options: ImageGenerationOptions | null,
      force: boolean,
    ) {
      if (!force && generateInFlight.has(id)) return;

      try {
        const next = await postGenerate(id, options, force);
        if (!active) return;
        latestStatus = next.status;
        applySession({
          ...next,
          resultUrl: force ? withCacheBust(next.resultUrl) : next.resultUrl,
        });
      } catch (caught) {
        if (!active) return;
        // Polling stays authoritative; a lost generate call is not fatal on
        // its own because the server may still be rendering.
        if (latestStatus !== "complete") {
          setError(
            caught instanceof Error
              ? caught.message
              : "無法完成你的人像創作。",
          );
        }
      }
    }

    async function begin() {
      const result = await readStatus();
      if (!active) return;

      if (result.kind === "offline") {
        setOffline(true);
        schedulePoll(OFFLINE_RETRY_MS);
        return;
      }

      if (result.kind === "gone") {
        setError(result.message);
        return;
      }

      const current = result.session;
      latestStatus = current.status;
      applySession(current);

      if (
        tuningEnabled &&
        !current.generationOptions &&
        (current.status === "ready" || current.status === "failed")
      ) {
        setPendingForce(current.status === "failed");
        setShowSettings(true);
      }

      schedulePoll(POLL_INTERVAL_MS);
    }

    // Phones throttle timers the moment the guest locks the screen or switches
    // apps, so a wait that spans a pocket trip would otherwise come back to a
    // stale clock and a stale status. Catch up the instant we are visible.
    function wake() {
      if (!active || document.visibilityState === "hidden") return;
      setNow(Date.now());
      schedulePoll(0);
    }

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);

    void begin();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [id, tuningEnabled, applySession]);

  const complete = session?.status === "complete" && session.resultUrl;
  const failed = Boolean(error) || session?.status === "failed";
  // Deliberately not gated on `session`: the clock has to keep moving before
  // the first response too, otherwise a page that cannot reach the server just
  // sits at 0:00 and looks broken.
  const waiting = !complete && !failed;

  useEffect(() => {
    if (!waiting) return;
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(ticker);
  }, [waiting]);

  async function runWithOptions(
    options: ImageGenerationOptions,
    force: boolean,
  ) {
    setLastOptions(options);
    setShowSettings(false);
    setError(null);
    setPendingForce(force);
    setSession((current) =>
      current
        ? {
            ...current,
            status: "generating",
            startedAt: current.startedAt ?? new Date().toISOString(),
            resultUrl: force ? null : current.resultUrl,
            error: null,
          }
        : current,
    );

    try {
      const next = await postGenerate(id, options, force);
      applySession({
        ...next,
        resultUrl: force ? withCacheBust(next.resultUrl) : next.resultUrl,
      });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "無法完成你的人像創作。",
      );
    }
  }

  async function retry() {
    setError(null);
    setSession((current) =>
      current
        ? {
            ...current,
            status: "generating",
            startedAt: new Date().toISOString(),
            error: null,
          }
        : current,
    );

    try {
      const next = await postGenerate(id, lastOptions, true);
      applySession({ ...next, resultUrl: withCacheBust(next.resultUrl) });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "無法完成你的人像創作。",
      );
    }
  }

  async function claimIdentity() {
    setIdentityError(null);
    setClaiming(true);
    try {
      const response = await fetch(`/api/sessions/${id}/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineId, mobile }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "無法保存身分資料。");
      }
      applySession(payload as SessionStatus);
    } catch (caught) {
      setIdentityError(
        caught instanceof Error ? caught.message : "無法保存身分資料。",
      );
    } finally {
      setClaiming(false);
    }
  }

  async function requestAvatar() {
    setAvatarMessage(null);
    setAvatarBusy(true);
    try {
      const response = await fetch(`/api/sessions/${id}/avatar`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "無法替換路老師系統大頭貼。");
      }
      setAvatarMessage("已送出路老師系統，請稍候在 LINE 查看。");
    } catch (caught) {
      setAvatarMessage(
        caught instanceof Error
          ? caught.message
          : "無法替換路老師系統大頭貼。",
      );
    } finally {
      setAvatarBusy(false);
    }
  }

  // No session yet means we have not had a single successful reply from the
  // server, which is a connectivity problem rather than a slow render.
  const connecting = waiting && !session;
  const [mountedAt] = useState(() => Date.now());
  const startedAtMs = session
    ? Date.parse(session.startedAt ?? session.createdAt)
    : mountedAt;
  const elapsedMs = Math.max(0, now - startedAtMs);
  const connectionFailed = connecting && elapsedMs > CONNECT_TIMEOUT_MS;
  const stalled = waiting && !connecting && elapsedMs > STALL_AFTER_MS;
  // Ease toward 96% so the bar always advances without ever promising the end.
  const progress = showSettings
    ? 0
    : Math.min(0.96, 1 - Math.exp(-elapsedMs / (EXPECTED_DURATION_MS / 2.2)));
  const stageHint =
    STAGE_HINTS.find((stage) => elapsedMs < stage.until)?.label ??
    "就快完成了，再等一下下…";
  const canDismissSettings = Boolean(complete || failed);

  return (
    <main className="mobile-shell">
      <header className="mobile-header">
        <BloomMark />
        <span>私人創作空間</span>
      </header>

      <noscript>
        <div className="noscript-banner">
          這一頁需要 JavaScript 才能顯示你的人像，請用 Safari 或 Chrome 開啟。
        </div>
      </noscript>

      <section className="mobile-experience">
        {complete ? (
          <>
            <div className="mobile-title">
              <p className="eyebrow">路老師似顏繪</p>
              <h1>一路走來的光，已然綻放。</h1>
              <p>儲存、分享，或一鍵套用到路老師系統大頭貼。</p>
            </div>
            {session.generationOptions?.fakeGenerate && (
              <p className="demo-mode-banner" role="status">
                這是示範人像（假生成），不是依你的照片即時創作。請回到拍照裝置關閉「假生成」後重拍。
              </p>
            )}
            <div className="mobile-result">
              <Image
                src={session.resultUrl!}
                alt="你的智晟｜綻放 AI 藝術人像"
                fill
                unoptimized
                preload
                sizes="(max-width: 620px) 92vw, 520px"
              />
            </div>
            <div className="mobile-result-actions">
              <a
                className="primary-button mobile-download"
                href={`${session.resultUrl}&download=1`}
                download="zhisheng-bloom-portrait.jpg"
              >
                下載我的專屬人像
              </a>
              <button
                type="button"
                className="facebook-share-button"
                onClick={() => {
                  window.open(
                    buildFacebookShareUrl(
                      window.location.origin,
                      FACEBOOK_SHARE_QUOTE,
                    ),
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <FacebookIcon />
                分享到臉書
              </button>
            </div>

            {!session.identity ? (
              <form
                className="identity-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void claimIdentity();
                }}
              >
                <p className="identity-form-title">請先留下身分，方便我們對應</p>
                <p className="identity-form-hint">
                  只需填寫其中一項：路老師通用 Line ID，或台灣手機號碼。
                </p>
                <label className="identity-field">
                  <span>路老師通用 Line ID</span>
                  <input
                    value={lineId}
                    onChange={(event) => {
                      setLineId(event.target.value);
                      if (event.target.value.trim()) setMobile("");
                    }}
                    placeholder="例如 112-張小明-南投縣"
                    autoComplete="off"
                    disabled={Boolean(mobile.trim()) || claiming}
                  />
                </label>
                <p className="identity-or">或</p>
                <label className="identity-field">
                  <span>手機號碼</span>
                  <input
                    value={mobile}
                    onChange={(event) => {
                      setMobile(event.target.value);
                      if (event.target.value.trim()) setLineId("");
                    }}
                    placeholder="例如 0912345678"
                    inputMode="numeric"
                    autoComplete="tel"
                    disabled={Boolean(lineId.trim()) || claiming}
                  />
                </label>
                {identityError && (
                  <p className="error-message">{identityError}</p>
                )}
                <button
                  type="submit"
                  className="secondary-button identity-submit"
                  disabled={claiming || (!lineId.trim() && !mobile.trim())}
                >
                  {claiming ? "保存中…" : "確認身分"}
                </button>
              </form>
            ) : (
              <div className="identity-claimed">
                <p className="identity-claimed-label">
                  已登錄：
                  {session.identity.kind === "lineId"
                    ? session.identity.value
                    : session.identity.value.replace(
                        /^(\d{4})\d{3}(\d{3})$/,
                        "$1***$2",
                      )}
                </p>
                <button
                  type="button"
                  className="primary-button avatar-button"
                  onClick={() => void requestAvatar()}
                  disabled={avatarBusy}
                >
                  {avatarBusy
                    ? "送出中…"
                    : "一鍵替換成路老師系統大頭貼"}
                </button>
                {avatarMessage && (
                  <p className="avatar-message">{avatarMessage}</p>
                )}
              </div>
            )}

            {tuningEnabled && (
              <button
                type="button"
                className="dev-regen-button"
                onClick={() => {
                  setPendingForce(true);
                  setShowSettings(true);
                }}
              >
                Dev：用其他參數重新生成
              </button>
            )}
          </>
        ) : failed ? (
          <div className="mobile-error">
            <div className="error-flower">×</div>
            <p className="eyebrow">似乎出了點狀況</p>
            <h1>讓我們再試一次。</h1>
            <p>
              {error ||
                session?.error ||
                "請回到拍照裝置，重新開始一個創作空間。"}
            </p>
            <button type="button" className="retry-button" onClick={retry}>
              重新生成我的人像
            </button>
            {tuningEnabled && (
              <button
                type="button"
                className="dev-regen-button"
                onClick={() => {
                  setPendingForce(true);
                  setShowSettings(true);
                }}
              >
                Dev：調整參數後再試
              </button>
            )}
          </div>
        ) : (
          <div className="generation-wait">
            <div className="source-photo-wrap">
              {session?.inputUrl && (
                <Image
                  src={session.inputUrl}
                  alt="你的原始照片"
                  fill
                  unoptimized
                  loading="eager"
                  sizes="180px"
                />
              )}
              <div className="generating-overlay">
                <span className="spark spark-one">✦</span>
                <span className="spark spark-two">✦</span>
                <span className="spark spark-three">✦</span>
              </div>
            </div>
            <p className="eyebrow">路老師似顏繪</p>
            <h1>
              {showSettings
                ? "先選好開發參數。"
                : connectionFailed
                  ? "連不上創作空間。"
                  : connecting
                    ? "正在連線…"
                    : stalled
                      ? "比預期久了一些。"
                      : "你的似顏繪，正在悄悄綻放。"}
            </h1>
            <p>
              {showSettings
                ? "此彈窗僅在本地開發與 Vercel Preview 顯示，用來微調 OpenAI 成本與畫質。"
                : connectionFailed
                  ? "請確認手機與拍照裝置連著同一個 Wi-Fi，然後重新整理這一頁。"
                  : connecting
                    ? "正在讀取你的創作空間，馬上就好。"
                    : stalled
                      ? "這次的創作卡住了。你可以重新生成一次，通常很快就會完成。"
                      : "請保持此頁面開啟。你的 AI 藝術人像通常會在一至三分鐘內完成。"}
            </p>

            {!showSettings && (
              <>
                <div
                  className={
                    connecting ? "progress-track" : "progress-track is-determinate"
                  }
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress * 100)}
                  aria-label="人像生成進度"
                >
                  <span
                    style={
                      connecting
                        ? undefined
                        : { width: `${Math.round(progress * 100)}%` }
                    }
                  />
                </div>
                <p className="progress-label" aria-live="polite">
                  {offline
                    ? "連線中斷，重試中…"
                    : connectionFailed
                      ? "無法連線"
                      : connecting
                        ? "正在連線…"
                        : stalled
                          ? "尚未完成"
                          : stageHint}
                  <span className="progress-elapsed">
                    {formatElapsed(elapsedMs)}
                  </span>
                </p>

                {connectionFailed && (
                  <button
                    type="button"
                    className="retry-button"
                    onClick={() => window.location.reload()}
                  >
                    重新整理
                  </button>
                )}

                {stalled && (
                  <button
                    type="button"
                    className="retry-button"
                    onClick={retry}
                  >
                    重新生成我的人像
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <footer className="mobile-footer">
        用心創作・由 OpenAI 提供技術
      </footer>

      {tuningEnabled && (
        <DevImageSettingsModal
          open={showSettings}
          initial={lastOptions}
          confirmLabel={pendingForce ? "強制重新生成" : "開始生成"}
          onCancel={
            canDismissSettings ? () => setShowSettings(false) : undefined
          }
          onConfirm={(options) => {
            void runWithOptions(options, pendingForce);
          }}
        />
      )}
    </main>
  );
}

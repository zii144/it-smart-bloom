"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IMAGE_MODELS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  modelHint,
  qualityHint,
  sizeHint,
  type ImageGenerationOptions,
} from "@/lib/image-options";

/** Mirrors the server-side guards in `sessions.ts` so bad files fail instantly. */
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
/** A dropped folder should not turn into a four-figure OpenAI bill by accident. */
export const MAX_BATCH_FILES = 50;
const CONCURRENCY_CHOICES = [1, 2, 3, 4] as const;

type BatchStatus = "queued" | "running" | "done" | "failed";

type BatchItem = {
  key: string;
  name: string;
  previewUrl: string | null;
  /** False for files rejected before upload — there is nothing to send. */
  retryable: boolean;
  status: BatchStatus;
  sessionId: string | null;
  resultUrl: string | null;
  resultMime: string | null;
  error: string | null;
};

const STATUS_LABELS: Record<BatchStatus, string> = {
  queued: "等待中",
  running: "生成中",
  done: "已完成",
  failed: "失敗",
};

function extensionFor(mime: string | null) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function downloadName(item: BatchItem) {
  const base = item.name.replace(/\.[^.]+$/, "") || "portrait";
  return `bloom-${base}.${extensionFor(item.resultMime)}`;
}

function rejectionFor(file: File) {
  if (!SUPPORTED_TYPES.has(file.type)) {
    return "只支援 JPEG、PNG 或 WebP。";
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return "照片大小必須小於 12 MB。";
  }
  return null;
}

export function AdminBatchPanel({
  defaults,
  hasOpenAiKey,
  hasOpenAiPrompt,
  imageTuning,
}: {
  defaults: ImageGenerationOptions;
  hasOpenAiKey: boolean;
  hasOpenAiPrompt: boolean;
  imageTuning: boolean;
}) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const [concurrency, setConcurrency] = useState(2);
  const [useEnvDefaults, setUseEnvDefaults] = useState(true);
  const [options, setOptions] = useState<ImageGenerationOptions>(defaults);
  const [fakeGenerate, setFakeGenerate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const nextKey = useRef(0);
  // The queue itself lives in refs: React state only mirrors it for display, so
  // finishing one photo can start the next without waiting for a re-render.
  const files = useRef(new Map<string, File>());
  const pending = useRef<string[]>([]);
  const active = useRef(0);
  const paused = useRef(false);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const addFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      const picked = Array.from(incoming ?? []);
      if (picked.length === 0) return;

      const room = MAX_BATCH_FILES - items.length;
      if (room <= 0) {
        setNotice(`單一批次最多 ${MAX_BATCH_FILES} 張，請先清除已完成的項目。`);
        return;
      }

      const accepted = picked.slice(0, room);
      setNotice(
        accepted.length < picked.length
          ? `單一批次最多 ${MAX_BATCH_FILES} 張，已略過 ${
              picked.length - accepted.length
            } 張。`
          : null,
      );

      const added = accepted.map<BatchItem>((file) => {
        const rejection = rejectionFor(file);
        nextKey.current += 1;
        const key = `batch-${nextKey.current}`;

        let previewUrl: string | null = null;
        if (!rejection) {
          files.current.set(key, file);
          if (typeof URL.createObjectURL === "function") {
            previewUrl = URL.createObjectURL(file);
            previews.current.add(previewUrl);
          }
        }

        return {
          key,
          name: file.name || "未命名照片",
          previewUrl,
          retryable: !rejection,
          status: rejection ? "failed" : "queued",
          sessionId: null,
          resultUrl: null,
          resultMime: null,
          error: rejection,
        };
      });

      setItems((current) => [...current, ...added]);
    },
    [items.length],
  );

  const runItem = useCallback(
    async (key: string, file: File) => {
      try {
        const body = new FormData();
        body.append("image", file);
        // Sending nothing lets the server resolve the .env defaults; the system
        // prompt always comes from OPENAI_IMAGE_SYSTEM_PROMPT either way.
        if (!useEnvDefaults || fakeGenerate) {
          body.append(
            "imageOptions",
            JSON.stringify({
              ...(useEnvDefaults ? defaults : options),
              fakeGenerate,
            }),
          );
        }

        const response = await fetch("/api/admin30910/batch", {
          method: "POST",
          body,
          credentials: "same-origin",
        });
        const payload = (await response.json().catch(() => null)) as {
          id?: string;
          resultUrl?: string | null;
          resultMime?: string | null;
          error?: string;
        } | null;

        if (!response.ok || !payload?.resultUrl) {
          throw new Error(payload?.error || `生成失敗（${response.status}）`);
        }

        setItems((current) =>
          current.map((row) =>
            row.key === key
              ? {
                  ...row,
                  status: "done",
                  sessionId: payload.id ?? null,
                  resultUrl: payload.resultUrl ?? null,
                  resultMime: payload.resultMime ?? null,
                  error: null,
                }
              : row,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "生成失敗，請重試。";
        setItems((current) =>
          current.map((row) =>
            row.key === key ? { ...row, status: "failed", error: message } : row,
          ),
        );
      }
    },
    [defaults, fakeGenerate, options, useEnvDefaults],
  );

  // Latest-value refs keep `pump` stable so any caller — start, retry, or a
  // finishing render — reaches the same scheduler.
  const runItemRef = useRef(runItem);
  const concurrencyRef = useRef(concurrency);
  useEffect(() => {
    runItemRef.current = runItem;
    concurrencyRef.current = concurrency;
  }, [concurrency, runItem]);

  // Named function expression: the scheduler re-enters itself as each render
  // finishes, without depending on anything but refs.
  const pump = useCallback(function pump() {
    if (paused.current) {
      if (active.current === 0) setRunning(false);
      return;
    }

    while (active.current < concurrencyRef.current && pending.current.length) {
      const key = pending.current.shift() as string;
      const file = files.current.get(key);
      if (!file) continue;

      active.current += 1;
      setItems((current) =>
        current.map((row) =>
          row.key === key ? { ...row, status: "running", error: null } : row,
        ),
      );
      void runItemRef.current(key, file).finally(() => {
        active.current -= 1;
        pump();
      });
    }

    if (active.current === 0 && pending.current.length === 0) {
      setRunning(false);
    }
  }, []);

  const enqueue = useCallback(
    (keys: string[]) => {
      const known = new Set(pending.current);
      for (const key of keys) {
        if (!known.has(key) && files.current.has(key)) pending.current.push(key);
      }
      if (pending.current.length === 0) return;

      paused.current = false;
      setRunning(true);
      pump();
    },
    [pump],
  );

  const start = useCallback(() => {
    enqueue(
      items.filter((item) => item.status === "queued").map((item) => item.key),
    );
  }, [enqueue, items]);

  const pause = useCallback(() => {
    paused.current = true;
    if (active.current === 0) setRunning(false);
  }, []);

  const retry = useCallback(
    (key: string) => {
      setItems((current) =>
        current.map((row) =>
          row.key === key ? { ...row, status: "queued", error: null } : row,
        ),
      );
      enqueue([key]);
    },
    [enqueue],
  );

  const retryAllFailed = useCallback(() => {
    const keys = items
      .filter((item) => item.status === "failed" && item.retryable)
      .map((item) => item.key);
    setItems((current) =>
      current.map((row) =>
        keys.includes(row.key)
          ? { ...row, status: "queued", error: null }
          : row,
      ),
    );
    enqueue(keys);
  }, [enqueue, items]);

  const forget = useCallback((rows: BatchItem[]) => {
    const keys = new Set(rows.map((row) => row.key));
    for (const row of rows) {
      files.current.delete(row.key);
      if (!row.previewUrl) continue;
      URL.revokeObjectURL(row.previewUrl);
      previews.current.delete(row.previewUrl);
    }
    pending.current = pending.current.filter((key) => !keys.has(key));
  }, []);

  const removeItem = useCallback(
    (key: string) => {
      forget(items.filter((row) => row.key === key));
      setItems((current) => current.filter((row) => row.key !== key));
    },
    [forget, items],
  );

  const clearFinished = useCallback(() => {
    forget(items.filter((row) => row.status === "done"));
    setItems((current) => current.filter((row) => row.status !== "done"));
  }, [forget, items]);

  const downloadAll = useCallback(async () => {
    for (const item of items) {
      if (item.status !== "done" || !item.resultUrl) continue;
      const anchor = document.createElement("a");
      anchor.href = item.resultUrl;
      anchor.download = downloadName(item);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Browsers throttle a burst of downloads fired from one gesture.
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }, [items]);

  const queuedCount = items.filter((item) => item.status === "queued").length;
  const runningCount = items.filter((item) => item.status === "running").length;
  const doneCount = items.filter((item) => item.status === "done").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const retryableCount = items.filter(
    (item) => item.status === "failed" && item.retryable,
  ).length;

  return (
    <section className="admin-panel admin-batch">
      <header className="admin-panel-header">
        <div>
          <p>批次工具</p>
          <h2>批次生成人像</h2>
        </div>
        <span>
          {doneCount} 完成 · {failedCount} 失敗 · {queuedCount + runningCount}{" "}
          待處理
        </span>
      </header>

      {!hasOpenAiPrompt && (
        <p className="admin-banner">
          尚未設定 OPENAI_IMAGE_SYSTEM_PROMPT，批次生成會直接失敗。
        </p>
      )}
      {hasOpenAiPrompt && !hasOpenAiKey && !fakeGenerate && (
        <p className="admin-banner">尚未設定 OPENAI_API_KEY，真生成會失敗。</p>
      )}

      <div className="admin-batch-controls">
        <label
          className="admin-batch-drop"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            addFiles(event.dataTransfer?.files ?? null);
          }}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <strong>選擇照片或拖曳到這裡</strong>
          <small>
            JPEG／PNG／WebP，單張 12 MB 以內，一次最多 {MAX_BATCH_FILES} 張。
            提示詞固定使用 .env 的 OPENAI_IMAGE_SYSTEM_PROMPT。
          </small>
        </label>

        <div className="admin-batch-settings">
          <label className="admin-batch-field">
            <span>同時生成</span>
            <select
              value={concurrency}
              onChange={(event) => {
                setConcurrency(Number(event.target.value));
                concurrencyRef.current = Number(event.target.value);
                if (running) pump();
              }}
            >
              {CONCURRENCY_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value} 張
                </option>
              ))}
            </select>
          </label>

          <label className="admin-batch-toggle">
            <input
              type="checkbox"
              checked={useEnvDefaults}
              onChange={(event) => {
                setUseEnvDefaults(event.target.checked);
                if (event.target.checked) setOptions(defaults);
              }}
            />
            <span>
              使用 .env 參數
              <small>
                {defaults.model} · {defaults.quality} · {defaults.size}
              </small>
            </span>
          </label>

          {!useEnvDefaults && (
            <>
              <label className="admin-batch-field">
                <span>模型</span>
                <select
                  value={options.model}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      model: event.target
                        .value as ImageGenerationOptions["model"],
                    }))
                  }
                >
                  {IMAGE_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model} — {modelHint(model)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-batch-field">
                <span>品質</span>
                <select
                  value={options.quality}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      quality: event.target
                        .value as ImageGenerationOptions["quality"],
                    }))
                  }
                >
                  {IMAGE_QUALITIES.map((quality) => (
                    <option key={quality} value={quality}>
                      {quality} — {qualityHint(quality)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="admin-batch-field">
                <span>尺寸</span>
                <select
                  value={options.size}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      size: event.target.value as ImageGenerationOptions["size"],
                    }))
                  }
                >
                  {IMAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size} — {sizeHint(size)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {imageTuning && (
            <label className="admin-batch-toggle">
              <input
                type="checkbox"
                checked={fakeGenerate}
                onChange={(event) => setFakeGenerate(event.target.checked)}
              />
              <span>
                假生成
                <small>不呼叫 OpenAI，用示範人像測試流程。</small>
              </span>
            </label>
          )}
        </div>

        <div className="admin-batch-actions">
          <button
            type="button"
            className="primary-button"
            disabled={queuedCount === 0 || running}
            onClick={start}
          >
            {running ? "生成中…" : `開始生成（${queuedCount} 張）`}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!running}
            onClick={pause}
          >
            暫停佇列
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={retryableCount === 0}
            onClick={retryAllFailed}
          >
            重試失敗（{retryableCount}）
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={doneCount === 0}
            onClick={() => void downloadAll()}
          >
            下載全部（{doneCount}）
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={doneCount === 0}
            onClick={clearFinished}
          >
            清除已完成
          </button>
        </div>

        {running && runningCount > 0 && (
          <p className="admin-batch-hint">
            暫停只會停止派送新的照片，已在生成中的 {runningCount} 張會跑完。
          </p>
        )}
        {notice && <p className="admin-batch-hint">{notice}</p>}
      </div>

      {items.length === 0 ? (
        <p className="admin-empty">尚未選擇照片。</p>
      ) : (
        <ul className="admin-batch-list">
          {items.map((item) => (
            <li className="admin-batch-row" key={item.key}>
              <span className="admin-batch-thumbs">
                {item.previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.previewUrl} alt="" />
                )}
                {item.resultUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.resultUrl} alt="" />
                )}
              </span>
              <span className="admin-batch-body">
                <span className="admin-batch-name" title={item.name}>
                  {item.name}
                </span>
                {item.error && (
                  <span className="admin-session-error">{item.error}</span>
                )}
              </span>
              <span className={`admin-status admin-status-${item.status}`}>
                {STATUS_LABELS[item.status]}
              </span>
              <span className="admin-batch-row-actions">
                {item.status === "done" && item.resultUrl && (
                  <a href={item.resultUrl} download={downloadName(item)}>
                    下載
                  </a>
                )}
                {item.status === "done" && item.sessionId && (
                  <a
                    href={`/s/${item.sessionId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    開啟
                  </a>
                )}
                {item.status === "failed" && item.retryable && (
                  <button type="button" onClick={() => retry(item.key)}>
                    重試
                  </button>
                )}
                {item.status !== "running" && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.key)}
                    aria-label={`移除 ${item.name}`}
                  >
                    移除
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

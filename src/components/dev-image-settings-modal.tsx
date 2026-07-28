"use client";

import { useEffect, useId, useState } from "react";
import {
  IMAGE_MODELS,
  IMAGE_OUTPUT_FORMATS,
  IMAGE_QUALITIES,
  IMAGE_SIZES,
  modelHint,
  qualityHint,
  sizeHint,
  type ImageGenerationOptions,
} from "@/lib/image-options";

export const FAKE_GENERATE_PREF_KEY = "bloom.dev.fakeGenerate";

type DevImageSettingsModalProps = {
  open: boolean;
  initial?: ImageGenerationOptions | null;
  confirmLabel?: string;
  onCancel?: () => void;
  onConfirm: (options: ImageGenerationOptions) => void;
};

const FALLBACK: ImageGenerationOptions = {
  model: "gpt-image-2",
  quality: "medium",
  size: "1024x1024",
  outputFormat: "jpeg",
  outputCompression: 90,
  fakeGenerate: false,
};

function readFakeGeneratePref(): boolean | null {
  try {
    const raw = window.localStorage.getItem(FAKE_GENERATE_PREF_KEY);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    // private mode / blocked storage
  }
  return null;
}

function writeFakeGeneratePref(value: boolean) {
  try {
    window.localStorage.setItem(FAKE_GENERATE_PREF_KEY, value ? "1" : "0");
  } catch {
    // ignore
  }
}

function withStickyFakeGenerate(
  base: ImageGenerationOptions,
  initial?: ImageGenerationOptions | null,
): ImageGenerationOptions {
  // Explicit booth state wins; otherwise restore the last demo preference.
  if (initial && typeof initial.fakeGenerate === "boolean") {
    return { ...base, fakeGenerate: initial.fakeGenerate };
  }
  const sticky = readFakeGeneratePref();
  if (sticky !== null) {
    return { ...base, fakeGenerate: sticky };
  }
  return base;
}

export function DevImageSettingsModal({
  open,
  initial,
  confirmLabel = "開始生成",
  onCancel,
  onConfirm,
}: DevImageSettingsModalProps) {
  const titleId = useId();
  const [options, setOptions] = useState<ImageGenerationOptions>(() =>
    typeof window === "undefined"
      ? (initial ?? FALLBACK)
      : withStickyFakeGenerate(initial ?? FALLBACK, initial),
  );
  const [hasApiKey, setHasApiKey] = useState(true);
  const [ready, setReady] = useState(Boolean(initial));

  useEffect(() => {
    if (!open) return;

    let active = true;

    async function loadDefaults() {
      try {
        const response = await fetch("/api/dev/image-options", {
          cache: "no-store",
        });
        if (!response.ok) {
          if (active) {
            setOptions(withStickyFakeGenerate(initial ?? FALLBACK, initial));
            setReady(true);
          }
          return;
        }
        const payload = (await response.json()) as {
          defaults: ImageGenerationOptions;
          hasApiKey: boolean;
        };
        if (!active) return;
        setHasApiKey(payload.hasApiKey);
        setOptions(
          withStickyFakeGenerate(initial ?? payload.defaults, initial),
        );
        setReady(true);
      } catch {
        if (active) {
          setOptions(withStickyFakeGenerate(initial ?? FALLBACK, initial));
          setReady(true);
        }
      }
    }

    void loadDefaults();
    return () => {
      active = false;
    };
  }, [open, initial]);

  if (!open) return null;

  const compressionDisabled = options.outputFormat === "png";

  return (
    <div className="dev-settings-backdrop" role="presentation">
      <div
        className="dev-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="dev-settings-header">
          <p className="eyebrow">Dev / Preview</p>
          <h2 id={titleId}>OpenAI 圖片參數</h2>
          <p>調整模型與品質以控制成本；僅在本地開發與 Vercel Preview 顯示。</p>
        </header>

        {!hasApiKey && !options.fakeGenerate && (
          <p className="dev-settings-warning">
            尚未設定 OPENAI_API_KEY，真生成會失敗。可改勾「假生成」走完整流程。
          </p>
        )}

        <form
          className="dev-settings-form"
          onSubmit={(event) => {
            event.preventDefault();
            writeFakeGeneratePref(options.fakeGenerate);
            onConfirm(options);
          }}
        >
          <label className="dev-settings-fake">
            <input
              type="checkbox"
              checked={options.fakeGenerate}
              disabled={!ready}
              onChange={(event) => {
                const fakeGenerate = event.target.checked;
                writeFakeGeneratePref(fakeGenerate);
                setOptions((current) => ({
                  ...current,
                  fakeGenerate,
                }));
              }}
            />
            <span>
              <strong>假生成 Fake generate</strong>
              <small>
                跳過 OpenAI，用示範人像走完整流程（約 1 秒，不花費 token）
              </small>
            </span>
          </label>

          {options.fakeGenerate && (
            <p className="dev-settings-fake-note">
              流程測試模式：不會呼叫 OpenAI，結果為示範水彩人像；QR、手機認領等後續步驟仍照常。
            </p>
          )}

          <label className="dev-settings-field">
            <span>模型 Model</span>
            <select
              value={options.model}
              disabled={!ready || options.fakeGenerate}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  model: event.target.value as ImageGenerationOptions["model"],
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

          <label className="dev-settings-field">
            <span>品質 Quality</span>
            <select
              value={options.quality}
              disabled={!ready || options.fakeGenerate}
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

          <label className="dev-settings-field">
            <span>尺寸 Size</span>
            <select
              value={options.size}
              disabled={!ready || options.fakeGenerate}
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

          <label className="dev-settings-field">
            <span>輸出格式 Format</span>
            <select
              value={options.outputFormat}
              disabled={!ready || options.fakeGenerate}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  outputFormat: event.target
                    .value as ImageGenerationOptions["outputFormat"],
                }))
              }
            >
              {IMAGE_OUTPUT_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </label>

          <label className="dev-settings-field">
            <span>
              JPEG/WebP 壓縮 Compression（{options.outputCompression}）
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={options.outputCompression}
              disabled={!ready || compressionDisabled || options.fakeGenerate}
              onChange={(event) =>
                setOptions((current) => ({
                  ...current,
                  outputCompression: Number(event.target.value),
                }))
              }
            />
            <small>
              {compressionDisabled
                ? "PNG 不支援壓縮參數"
                : "數字越低檔案越小，畫質也越差"}
            </small>
          </label>

          <div className="dev-settings-summary">
            <strong>本次設定</strong>
            <code>
              {options.fakeGenerate
                ? "FAKE · 示範人像 · 流程測試"
                : `${options.model} · ${options.quality} · ${options.size} · ${options.outputFormat}${
                    options.outputFormat !== "png"
                      ? ` @${options.outputCompression}`
                      : ""
                  }`}
            </code>
          </div>

          <div className="dev-settings-actions">
            {onCancel && (
              <button
                type="button"
                className="secondary-button"
                onClick={onCancel}
              >
                取消
              </button>
            )}
            <button type="submit" className="primary-button" disabled={!ready}>
              {options.fakeGenerate ? "假生成並繼續" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

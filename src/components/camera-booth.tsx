"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BloomMark } from "@/components/brand";
import { DevImageSettingsModal } from "@/components/dev-image-settings-modal";
import {
  activeDeviceId,
  describeCameraError,
  requestUserCamera,
  writeCameraPreference,
} from "@/lib/camera-access";
import { isValidLineId, normalizeLineId } from "@/lib/guest-identity";
import type { ImageGenerationOptions } from "@/lib/image-options";
import { buildLineShareUrl } from "@/lib/line-share";

type SessionPayload = {
  id: string;
  status: "ready" | "generating" | "complete" | "failed";
  expiresAt: string;
  inputUrl: string;
  resultUrl: string | null;
  error: string | null;
  sessionUrl: string;
  qrDataUrl: string;
  generationOptions?: ImageGenerationOptions | null;
};

type BoothStep =
  | "invitation"
  | "upload"
  | "intro"
  | "camera"
  | "preview"
  | "sharing";

type CameraOption = { deviceId: string; label: string };
type PhotoSource = "upload" | "camera";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const SUPPORTED_UPLOAD_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        className="icon-ghost-line"
        d="M8.1 5.7 9.5 3.9h5.1l1.3 1.8h3.2c1.5 0 2.5 1 2.5 2.4v8.8c0 1.5-1 2.5-2.5 2.5H4.9c-1.5 0-2.5-1-2.5-2.5V8.1c0-1.4 1-2.4 2.5-2.4h3.2Z"
      />
      <path d="M8.2 5.5 9.4 3.8h5.2l1.2 1.7H19A2.5 2.5 0 0 1 21.5 8v9A2.5 2.5 0 0 1 19 19.5H5A2.5 2.5 0 0 1 2.5 17V8A2.5 2.5 0 0 1 5 5.5h3.2Z" />
      <circle className="icon-ghost-line" cx="12.2" cy="12.3" r="4.15" />
      <circle cx="12" cy="12.5" r="4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="icon-ghost-line" d="M5 12.4h14M14.2 7.2l5 5-5 5" />
      <path d="M5 12h14M14 7l5 5-5 5" />
    </svg>
  );
}

function PhotoUploadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.5 3.5h15a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <circle cx="8" cy="8" r="1.8" />
      <path d="m3.2 17 4.7-4.6 3.4 3.2 2.6-2.6 6.9 6.4M12 3.5v-2M9.8 1.5h4.4" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg className="watercolor-spark" viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <filter
          id="spark-watercolor"
          x="-22%"
          y="-22%"
          width="144%"
          height="144%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".075"
            numOctaves="2"
            seed="4"
            result="sparkNoise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="sparkNoise"
            scale=".85"
          />
        </filter>
      </defs>
      <g filter="url(#spark-watercolor)">
        <path
          className="spark-wash"
          d="M12 1.8c.8 5.9 4.1 9.2 10.2 10.2-6.1.8-9.4 4.1-10.2 10.2C11.1 16.1 7.8 12.8 1.8 12 7.8 11 11.1 7.7 12 1.8Z"
        />
        <path d="M12 3.5c.6 5 3.5 7.9 8.5 8.5-5 .7-7.9 3.5-8.5 8.5-.7-5-3.5-7.8-8.5-8.5 5-.6 7.8-3.5 8.5-8.5Z" />
      </g>
    </svg>
  );
}

function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.7 9.7c0-4-4-7.3-8.9-7.3S1.9 5.7 1.9 9.7c0 3.6 3.2 6.7 7.5 7.2.29.06.69.19.79.44.09.23.06.59.03.82l-.14.86c-.04.25-.2 1 .95.54 1.15-.44 6.2-3.65 8.47-6.25 1.56-1.7 2.2-3.42 2.2-5.11Z"
      />
    </svg>
  );
}

export function CameraBooth({
  tuningEnabled = false,
}: {
  tuningEnabled?: boolean;
}) {
  const [step, setStep] = useState<BoothStep>("invitation");
  const [lineId, setLineId] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoSource, setPhotoSource] = useState<PhotoSource | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tuningOptions, setTuningOptions] =
    useState<ImageGenerationOptions | null>(null);
  const [cameras, setCameras] = useState<CameraOption[]>([]);
  const [currentCameraId, setCurrentCameraId] = useState<string | null>(null);
  const [streamEpoch, setStreamEpoch] = useState(0);
  const lineIdInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const guestEntryHeadingRef = useRef<HTMLHeadingElement>(null);
  const introHeadingRef = useRef<HTMLHeadingElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl, stopCamera]);

  // Attaching in a layout-safe effect (instead of requestAnimationFrame after
  // setStep) guarantees the element exists, and iOS Safari needs the explicit
  // play() call before it renders frames from a srcObject stream.
  useEffect(() => {
    if (step !== "camera") return;

    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    void Promise.resolve(video.play()).catch((caught) => {
      console.warn("[bloom] video.play() rejected", caught);
    });
  }, [step, streamEpoch]);

  useEffect(() => {
    if (!session || step !== "sharing") return;

    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/sessions/${session.id}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const next = (await response.json()) as SessionPayload;
        setSession((current) => (current ? { ...current, ...next } : current));

        if (next.status === "failed") {
          setError(next.error || "人像生成失敗，請再試一次。");
        }
        // Stay on the QR screen after complete so the guest can still scan /
        // open LINE. Fake generate finishes in ~1s; auto-returning home was
        // wiping the link before demos (and fast real renders) could finish.
      } catch {
        // A transient polling failure should not interrupt the session.
      }
    }, 2000);

    return () => window.clearInterval(poll);
  }, [session, step]);

  async function openCamera() {
    setError(null);

    if (!window.isSecureContext) {
      setError(describeCameraError(new DOMException("insecure", "SecurityError")));
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("此瀏覽器不支援相機功能。");
      return;
    }

    try {
      const stream = await requestUserCamera();
      streamRef.current = stream;
      setStep("camera");
      setStreamEpoch((epoch) => epoch + 1);
      void refreshCameras(stream);
    } catch (error) {
      console.warn("[bloom] getUserMedia failed", error);
      setError(describeCameraError(error));
    }
  }

  async function refreshCameras(stream: MediaStream) {
    setCurrentCameraId(activeDeviceId(stream));

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(
        devices
          .filter((device) => device.kind === "videoinput" && device.deviceId)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `相機 ${index + 1}`,
          })),
      );
    } catch {
      // Device listing is a convenience; the booth still works without it.
    }
  }

  async function switchCamera(deviceId: string) {
    setError(null);

    try {
      const stream = await requestUserCamera({ deviceId });
      stopCamera();
      streamRef.current = stream;
      writeCameraPreference(deviceId);
      setCurrentCameraId(activeDeviceId(stream) ?? deviceId);
      setStreamEpoch((epoch) => epoch + 1);
    } catch (error) {
      console.warn("[bloom] camera switch failed", error);
      setError(describeCameraError(error));
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return;

    const sourceSize = Math.min(video.videoWidth, video.videoHeight);
    const sourceX = (video.videoWidth - sourceSize) / 2;
    const sourceY = (video.videoHeight - sourceSize) / 2;
    const outputSize = Math.min(sourceSize, 1280);
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.translate(outputSize, 0);
    context.scale(-1, 1);
    context.drawImage(
      video,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      outputSize,
      outputSize,
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("無法拍下照片，請再試一次。");
          return;
        }
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPhoto(blob);
        setPhotoSource("camera");
        setPreviewUrl(URL.createObjectURL(blob));
        stopCamera();
        setStep("preview");
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    const returnToUpload = photoSource === "upload";
    setPhoto(null);
    setPhotoSource(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (returnToUpload) {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      setError(null);
      setStep("upload");
      return;
    }
    void openCamera();
  }

  async function createShareSession(options?: ImageGenerationOptions | null) {
    if (!photo) return;

    if (tuningEnabled && !options && !tuningOptions) {
      setShowSettings(true);
      return;
    }

    if (options) setTuningOptions(options);
    setError(null);
    setStep("sharing");
    setShowSettings(false);

    try {
      const formData = new FormData();
      formData.set("image", photo, "portrait.jpg");
      if (lineId.trim()) {
        formData.set("lineId", normalizeLineId(lineId));
      }
      const optionsToStore = options ?? tuningOptions;
      if (optionsToStore) {
        formData.set("imageOptions", JSON.stringify(optionsToStore));
      }
      const response = await fetch("/api/sessions", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "無法建立人像創作連結。");
      }

      // Force the next guest through the options modal again so a one-off
      // "假生成" choice cannot silently stick for the rest of the booth day.
      setTuningOptions(null);
      setSession(payload as SessionPayload);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "無法分享這張照片。",
      );
      setStep("preview");
    }
  }

  function startOver() {
    // Full navigation clears camera streams and session state so the next
    // guest always starts from a fresh booth.
    window.location.assign("/");
  }

  function acceptInvitation() {
    setError(null);
    setStep("upload");
    window.requestAnimationFrame(() =>
      guestEntryHeadingRef.current?.focus({ preventScroll: true }),
    );
  }

  function validateLineId() {
    const normalized = normalizeLineId(lineId);
    if (!isValidLineId(normalized)) {
      setError("LINE ID 格式需為「數字-姓名-地區」，例如 112-張小明-南投縣。");
      window.requestAnimationFrame(() => lineIdInputRef.current?.focus());
      return null;
    }
    setLineId(normalized);
    return normalized;
  }

  function selectUploadedPhoto(file: File | undefined) {
    if (!file) return;

    if (!SUPPORTED_UPLOAD_TYPES.has(file.type)) {
      setError("請上傳 JPEG、PNG 或 WebP 格式的照片。");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      setError("照片大小需小於 12 MB。");
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhoto(file);
    setPhotoSource("upload");
    setPreviewUrl(URL.createObjectURL(file));
    setError(null);
  }

  function reviewUpload() {
    if (!validateLineId()) return;
    if (!photo || photoSource !== "upload") {
      setError("請選擇一張想要創作的照片。");
      uploadInputRef.current?.focus();
      return;
    }
    setError(null);
    setStep("preview");
  }

  function continueWithCamera() {
    if (!validateLineId()) return;
    setError(null);
    setStep("intro");
    window.requestAnimationFrame(() =>
      introHeadingRef.current?.focus({ preventScroll: true }),
    );
  }

  return (
    <main className="booth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <BloomMark />
        <div className="privacy-note">
          <span className="privacy-dot" />
          私人創作空間
        </div>
      </header>

      <section className={`booth-stage booth-stage-${step}`}>
        {step === "invitation" && (
          <div
            className="invitation-welcome"
            aria-labelledby="invitation-title"
          >
            <div className="invitation-flower" aria-hidden="true">
              <Image
                src="/images/watercolor/peony.jpg"
                alt=""
                fill
                sizes="180px"
                loading="eager"
              />
            </div>

            <article className="invitation-card">
              <span
                className="invitation-corner invitation-corner-one"
                aria-hidden="true"
              />
              <span
                className="invitation-corner invitation-corner-two"
                aria-hidden="true"
              />

              <div className="invitation-seal" aria-hidden="true">
                <SparkIcon />
              </div>
              <p className="invitation-overline">A WARM INVITATION · 誠摯邀請</p>
              <h1 id="invitation-title">
                給親愛的您，
                <br />
                <em>一封綻放的邀請。</em>
              </h1>
              <div className="invitation-rule" aria-hidden="true">
                <span />
                <i />
                <span />
              </div>
              <p className="invitation-message">
                歲末成果展，邀您靜靜回望這一年——
                <br className="invitation-desktop-break" />
                導師的陪伴、實習的成長，都成了心裡的光。
                <br className="invitation-desktop-break" />
                讓路老師以一幅水彩，為這段旅程留下溫柔的紀念。
              </p>
              <p className="invitation-signature">
                期待與您，一起綻放
                <span>智晟團隊 敬邀</span>
              </p>
              <button
                className="primary-button invitation-button"
                onClick={acceptInvitation}
              >
                欣然赴約
                <span className="button-arrow">
                  <ArrowIcon />
                </span>
              </button>
              <p className="invitation-footnote">為您留一席溫柔的光</p>
            </article>
          </div>
        )}

        {step === "upload" && (
          <div className="guest-entry-layout">
            <div className="guest-entry-copy">
              <p className="eyebrow">
                <span>
                  <SparkIcon />
                </span>
                您的專屬邀請
              </p>
              <h1 ref={guestEntryHeadingRef} tabIndex={-1}>
                留下名字，選一張喜歡的自己。
              </h1>
              <p>
                填寫路老師通用 LINE ID，再上傳一張清楚的正面照片，
                我們會把一路走來的光，畫成你的專屬水彩似顏繪。
              </p>
              <div className="guest-entry-note">
                <span aria-hidden="true">01</span>
                <p>
                  <strong>LINE ID 會與作品一同保存</strong>
                  方便日後在路老師系統中找到這次創作。
                </p>
              </div>
            </div>

            <form
              className="guest-entry-form"
              onSubmit={(event) => {
                event.preventDefault();
                reviewUpload();
              }}
            >
              <div className="guest-entry-form-heading">
                <span>RSVP</span>
                <h2>準備你的似顏繪</h2>
                <p>兩個步驟，就可以開始創作。</p>
              </div>

              <label className="guest-entry-field" htmlFor="guest-line-id">
                <span>
                  路老師通用 LINE ID
                  <b>必填</b>
                </span>
                <input
                  ref={lineIdInputRef}
                  id="guest-line-id"
                  name="lineId"
                  type="text"
                  value={lineId}
                  onChange={(event) => {
                    setLineId(event.target.value);
                    setError(null);
                  }}
                  onBlur={() => {
                    if (
                      lineId.trim() &&
                      !isValidLineId(normalizeLineId(lineId))
                    ) {
                      setError(
                        "LINE ID 格式需為「數字-姓名-地區」，例如 112-張小明-南投縣。",
                      );
                    }
                  }}
                  placeholder="例如：112-張小明-南投縣"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="guest-line-id-help"
                  aria-invalid={error?.includes("LINE ID") || undefined}
                  required
                />
                <small id="guest-line-id-help">格式：數字－姓名－地區</small>
              </label>

              <label
                className={`guest-upload-field ${
                  previewUrl && photoSource === "upload" ? "has-photo" : ""
                }`}
              >
                <input
                  ref={uploadInputRef}
                  className="guest-file-input"
                  type="file"
                  name="image"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) =>
                    selectUploadedPhoto(event.target.files?.[0])
                  }
                  aria-describedby="guest-photo-help"
                />
                {previewUrl && photoSource === "upload" ? (
                  <>
                    <Image
                      src={previewUrl}
                      alt="已選擇的人像照片預覽"
                      fill
                      unoptimized
                      sizes="(max-width: 700px) 86vw, 360px"
                    />
                    <span className="guest-upload-change">點一下更換照片</span>
                  </>
                ) : (
                  <span className="guest-upload-empty">
                    <i>
                      <PhotoUploadIcon />
                    </i>
                    <strong>選擇一張照片</strong>
                    <small id="guest-photo-help">
                      JPEG、PNG 或 WebP・最大 12 MB
                    </small>
                  </span>
                )}
              </label>

              {error && (
                <p className="guest-entry-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="primary-button guest-entry-submit">
                預覽我的照片
                <span className="button-arrow">
                  <ArrowIcon />
                </span>
              </button>
              <button
                type="button"
                className="secondary-button guest-camera-option"
                onClick={continueWithCamera}
              >
                <CameraIcon />
                改用現場相機
              </button>
              <button
                type="button"
                className="text-button guest-entry-back"
                onClick={() => {
                  setError(null);
                  setStep("invitation");
                }}
              >
                返回邀請卡
              </button>
            </form>
          </div>
        )}

        {step === "intro" && (
          <div className="intro-grid">
            <div className="intro-copy">
              <p className="eyebrow">
                <span>
                  <SparkIcon />
                </span>
                路老師似顏繪
              </p>
              <h1 ref={introHeadingRef} tabIndex={-1}>
                在路老師系統中
                <br />
                <em className="shining-headline">
                  <span>綻放光芒。</span>
                  <i className="headline-spark headline-spark-one" aria-hidden="true">
                    ✦
                  </i>
                  <i className="headline-spark headline-spark-two" aria-hidden="true">
                    ✦
                  </i>
                  <i
                    className="headline-spark headline-spark-three"
                    aria-hidden="true"
                  >
                    ✧
                  </i>
                </em>
              </h1>
              <p className="hero-kicker">把一路走來的光，畫成你的模樣。</p>
              <p className="lede">
                為路老師留下溫暖而獨一無二的水彩人像。不需下載 App，
                也不需註冊，只要感受這一刻的美好。
              </p>
              <button className="primary-button" onClick={openCamera}>
                <span className="button-icon">
                  <CameraIcon />
                </span>
                開啟相機
                <span className="button-arrow">
                  <ArrowIcon />
                </span>
              </button>
              {error && <p className="error-message">{error}</p>}
              <div className="step-row" aria-label="使用方式">
                <div>
                  <b>01</b>
                  <span>拍下照片</span>
                </div>
                <div>
                  <b>02</b>
                  <span>掃描 QR Code</span>
                </div>
                <div>
                  <b>03</b>
                  <span>遇見你的似顏繪</span>
                </div>
              </div>
            </div>

            <div className="watercolor-showcase">
              <div className="watercolor-backdrop" aria-hidden="true">
                <Image
                  src="/images/watercolor/elder-male.jpg"
                  alt=""
                  fill
                  sizes="420px"
                  loading="eager"
                />
              </div>
              <div className="watercolor-portrait">
                <Image
                  src="/images/watercolor/elder-female.jpg"
                  alt="陽光下書寫的熟齡女性水彩畫"
                  fill
                  sizes="(max-width: 700px) 82vw, 500px"
                  preload
                />
                <div className="watercolor-light" aria-hidden="true" />
                <div className="art-caption">
                  <span>每一段人生</span>
                  <strong>都有綻放的光</strong>
                </div>
              </div>
              <div className="watercolor-flower" aria-hidden="true">
                <Image
                  src="/images/watercolor/peony.jpg"
                  alt=""
                  fill
                  sizes="170px"
                />
              </div>
              <div className="watercolor-note">
                <span>以光為彩</span>
                <span className="note-rule" />
                <span>為你而畫</span>
              </div>
            </div>
          </div>
        )}

        {step === "camera" && (
          <div className="capture-layout">
            <div className="stage-heading">
              <p className="eyebrow">找到最美的光</p>
              <h1>準備好了嗎？</h1>
              <p>將臉部置中，看著鏡頭，讓最自然的你輕輕綻放。</p>
            </div>
            <div className="camera-card">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onLoadedMetadata={() => setCameraReady(true)}
                onCanPlay={() => setCameraReady(true)}
                onPlaying={() => setCameraReady(true)}
              />
              <div className="camera-guide" />
              {!cameraReady && (
                <div className="camera-loading">
                  <span className="spinner" />
                  正在開啟相機…
                </div>
              )}
            </div>
            {cameras.length > 1 && (
              <label className="camera-picker">
                <span>鏡頭</span>
                <select
                  value={currentCameraId ?? ""}
                  onChange={(event) => void switchCamera(event.target.value)}
                >
                  {currentCameraId === null && <option value="">預設鏡頭</option>}
                  {cameras.map((camera) => (
                    <option key={camera.deviceId} value={camera.deviceId}>
                      {camera.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className="shutter"
              onClick={capturePhoto}
              disabled={!cameraReady}
              aria-label="拍下照片"
            >
              <span />
            </button>
            <button className="text-button" onClick={startOver}>
              取消
            </button>
          </div>
        )}

        {step === "preview" && previewUrl && (
          <div className="review-layout">
            <div className="stage-heading">
              <p className="eyebrow">很好看</p>
              <h1>就選這張嗎？</h1>
              <p>確認後會產生私人手機連結，人像會保存於路老師系統。</p>
            </div>
            <div className="review-image">
              <Image
                src={previewUrl}
                alt="你剛拍下的人像照片"
                fill
                unoptimized
                sizes="(max-width: 700px) 84vw, 440px"
              />
            </div>
            <div className="review-actions">
              <button className="secondary-button" onClick={retake}>
                重新拍攝
              </button>
              <button className="primary-button" onClick={() => void createShareSession()}>
                使用這張照片
                <span className="button-arrow">
                  <ArrowIcon />
                </span>
              </button>
            </div>
            {error && <p className="error-message">{error}</p>}
          </div>
        )}

        {step === "sharing" && (
          <div className="share-layout">
            {!session ? (
              <div className="creation-loader">
                <div className="bloom-loader">
                  <BloomMark compact />
                </div>
                <p className="eyebrow">正在準備手機連結</p>
                <h1>請稍候片刻…</h1>
              </div>
            ) : (
              <>
                {session.generationOptions?.fakeGenerate && (
                  <p className="demo-mode-banner" role="status">
                    示範模式：這次是假生成，掃 QR 會看到固定示範人像，不是這位訪客的真實結果。
                  </p>
                )}
                <div className="share-copy">
                  <p className="eyebrow">接續在手機上體驗</p>
                  <h1>
                    {session.status === "complete"
                      ? "請用手機開啟連結。"
                      : "掃描，或用 LINE 接收。"}
                  </h1>
                  <p>
                    {session.status === "complete"
                      ? "人像已在手機頁面就緒：可下載、分享到臉書，並留下身分。攤位保留 QR，方便尚未掃碼的訪客。"
                      : "開啟手機相機掃描 QR Code，或點下方按鈕透過 LINE 接收私人連結。進入頁面後，我們就會開始創作你的路老師似顏繪。"}
                  </p>
                  <div className="live-status">
                    <span
                      className={
                        session.status === "generating" ? "pulse-dot" : ""
                      }
                    />
                    {session.generationOptions?.fakeGenerate
                      ? "示範人像已就緒・請勿當成正式結果"
                      : session.status === "complete"
                      ? "手機端人像已完成・QR 仍可掃描"
                      : session.status === "generating"
                        ? "正在創作你的路老師似顏繪"
                        : session.status === "failed"
                          ? "創作失敗・請重新開始"
                          : "等待手機開啟連結"}
                  </div>
                </div>
                <div className="share-actions">
                  <div className="qr-card">
                    <Image
                      src={session.qrDataUrl}
                      alt="私人藝術人像連結 QR Code"
                      width={320}
                      height={320}
                      unoptimized
                      loading="eager"
                    />
                    <p>私人連結・請用手機開啟</p>
                  </div>
                  <a
                    className="line-receive-button"
                    href={buildLineShareUrl(
                      session.sessionUrl,
                      "開啟你的路老師似顏繪（私人連結）",
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <LineIcon />
                    用 LINE 接收連結
                  </a>
                </div>
                {error && <p className="error-message">{error}</p>}
                {session.status === "complete" ? (
                  <button className="primary-button" onClick={startOver}>
                    下一組訪客
                  </button>
                ) : (
                  <button className="text-button" onClick={startOver}>
                    重新開始
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>用心創作・由 OpenAI 提供技術</span>
        <span>繼續使用即表示你同意進行 AI 圖像處理。</span>
      </footer>

      {tuningEnabled && (
        <DevImageSettingsModal
          open={showSettings}
          initial={tuningOptions}
          confirmLabel="套用並建立連結"
          onCancel={() => setShowSettings(false)}
          onConfirm={(options) => {
            setTuningOptions(options);
            void createShareSession(options);
          }}
        />
      )}
    </main>
  );
}

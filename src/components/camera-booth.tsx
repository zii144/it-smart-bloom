"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BloomMark } from "@/components/brand";

type SessionPayload = {
  id: string;
  status: "ready" | "generating" | "complete" | "failed";
  expiresAt: string;
  inputUrl: string;
  resultUrl: string | null;
  error: string | null;
  sessionUrl: string;
  qrDataUrl: string;
};

type BoothStep = "intro" | "camera" | "preview" | "sharing" | "result";

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

export function CameraBooth() {
  const [step, setStep] = useState<BoothStep>("intro");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
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

        if (next.status === "complete") {
          setStep("result");
        } else if (next.status === "failed") {
          setError(next.error || "人像生成失敗，請再試一次。");
        }
      } catch {
        // A transient polling failure should not interrupt the session.
      }
    }, 2000);

    return () => window.clearInterval(poll);
  }, [session, step]);

  async function openCamera() {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("此瀏覽器不支援相機功能。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setStep("camera");

      window.requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      });
    } catch {
      setError(
        "相機權限遭到封鎖，請允許相機存取後再試一次。",
      );
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
        setPreviewUrl(URL.createObjectURL(blob));
        stopCamera();
        setStep("preview");
      },
      "image/jpeg",
      0.9,
    );
  }

  function retake() {
    setPhoto(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    void openCamera();
  }

  async function createShareSession() {
    if (!photo) return;
    setError(null);
    setStep("sharing");

    try {
      const formData = new FormData();
      formData.set("image", photo, "portrait.jpg");
      const response = await fetch("/api/sessions", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "無法建立人像創作連結。");
      }

      setSession(payload as SessionPayload);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "無法分享這張照片。",
      );
      setStep("preview");
    }
  }

  function startOver() {
    setPhoto(null);
    setSession(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setStep("intro");
  }

  return (
    <main className="booth-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="site-header">
        <BloomMark />
        <div className="privacy-note">
          <span className="privacy-dot" />
          照片將於 15 分鐘後刪除
        </div>
      </header>

      <section className={`booth-stage booth-stage-${step}`}>
        {step === "intro" && (
          <div className="intro-grid">
            <div className="intro-copy">
              <p className="eyebrow">
                <span>
                  <SparkIcon />
                </span>
                路老師似顏繪
              </p>
              <h1>
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
                onCanPlay={() => setCameraReady(true)}
              />
              <div className="camera-guide" />
              {!cameraReady && (
                <div className="camera-loading">
                  <span className="spinner" />
                  正在開啟相機…
                </div>
              )}
            </div>
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
              <p>照片會保持私密，並於 15 分鐘後自動刪除。</p>
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
              <button className="primary-button" onClick={createShareSession}>
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
                <div className="share-copy">
                  <p className="eyebrow">接續在手機上體驗</p>
                  <h1>掃描，開啟你的似顏繪。</h1>
                  <p>
                    開啟手機相機並掃描 QR Code。進入頁面後，
                    我們就會立即開始創作你的路老師似顏繪。
                  </p>
                  <div className="live-status">
                    <span
                      className={
                        session.status === "generating" ? "pulse-dot" : ""
                      }
                    />
                    {session.status === "generating"
                      ? "正在創作你的路老師似顏繪"
                      : "等待手機掃描"}
                  </div>
                </div>
                <div className="qr-card">
                  <Image
                    src={session.qrDataUrl}
                    alt="私人藝術人像連結 QR Code"
                    width={320}
                    height={320}
                    unoptimized
                    loading="eager"
                  />
                  <p>私人連結・15 分鐘後失效</p>
                </div>
                {error && <p className="error-message">{error}</p>}
                <button className="text-button" onClick={startOver}>
                  重新開始
                </button>
              </>
            )}
          </div>
        )}

        {step === "result" && session?.resultUrl && (
          <div className="result-layout">
            <div className="stage-heading">
              <p className="eyebrow">路老師似顏繪</p>
              <h1>一路走來的光，已然綻放。</h1>
            </div>
            <div className="result-image">
              <Image
                src={session.resultUrl}
                alt="你的智晟｜綻放 AI 藝術人像"
                fill
                unoptimized
                preload
                sizes="(max-width: 700px) 88vw, 560px"
              />
            </div>
            <div className="result-actions">
              <a
                className="primary-button"
                href={`${session.resultUrl}&download=1`}
                download="zhisheng-bloom-portrait.jpg"
              >
                下載專屬人像
              </a>
              <button className="secondary-button" onClick={startOver}>
                再創作一張
              </button>
            </div>
          </div>
        )}
      </section>

      <footer className="site-footer">
        <span>用心創作・由 OpenAI 提供技術</span>
        <span>繼續使用即表示你同意進行 AI 圖像處理。</span>
      </footer>
    </main>
  );
}

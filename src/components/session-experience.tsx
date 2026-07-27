"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { BloomMark } from "@/components/brand";

type SessionStatus = {
  id: string;
  status: "ready" | "generating" | "complete" | "failed";
  expiresAt: string;
  inputUrl: string;
  resultUrl: string | null;
  error: string | null;
};

export function SessionExperience({ id }: { id: string }) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    async function readSession() {
      try {
        const response = await fetch(`/api/sessions/${id}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "此連結目前無法使用。");
        if (!active) return;
        setSession(payload as SessionStatus);

        if (payload.status !== "complete" && payload.status !== "failed") {
          timer = window.setTimeout(readSession, 2000);
        }
      } catch (caught) {
        if (!active) return;
        setError(
          caught instanceof Error ? caught.message : "此連結目前無法使用。",
        );
      }
    }

    async function triggerGeneration() {
      try {
        const generationResponse = await fetch(
          `/api/sessions/${id}/generate`,
          { method: "POST" },
        );
        const generated = await generationResponse.json();
        if (!generationResponse.ok) {
          throw new Error(
            generated.error || "無法完成你的人像創作。",
          );
        }
        if (active) setSession(generated as SessionStatus);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "無法完成你的人像創作。",
          );
        }
      }
    }

    async function begin() {
      try {
        const initialResponse = await fetch(`/api/sessions/${id}`, {
          cache: "no-store",
        });
        const initial = await initialResponse.json();
        if (!initialResponse.ok) {
          throw new Error(initial.error || "此連結目前無法使用。");
        }
        if (!active) return;
        setSession(initial as SessionStatus);

        if (initial.status === "ready" || initial.status === "failed") {
          void triggerGeneration();
        }

        timer = window.setTimeout(readSession, 800);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "無法完成你的人像創作。",
          );
        }
      }
    }

    void begin();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [id]);

  const complete = session?.status === "complete" && session.resultUrl;

  return (
    <main className="mobile-shell">
      <header className="mobile-header">
        <BloomMark />
        <span>私人創作空間</span>
      </header>

      <section className="mobile-experience">
        {complete ? (
          <>
            <div className="mobile-title">
              <p className="eyebrow">路老師似顏繪</p>
              <h1>一路走來的光，已然綻放。</h1>
              <p>儲存、分享，或把這份美好珍藏在身邊。</p>
            </div>
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
            <a
              className="primary-button mobile-download"
              href={`${session.resultUrl}&download=1`}
              download="zhisheng-bloom-portrait.jpg"
            >
              下載我的專屬人像
            </a>
            <p className="expiry-copy">此連結將於 15 分鐘後失效</p>
          </>
        ) : error || session?.status === "failed" ? (
          <div className="mobile-error">
            <div className="error-flower">×</div>
            <p className="eyebrow">似乎出了點狀況</p>
            <h1>讓我們再試一次。</h1>
            <p>
              {error ||
                session?.error ||
                "請回到拍照裝置，重新開始一個創作空間。"}
            </p>
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
            <h1>你的似顏繪，正在悄悄綻放。</h1>
            <p>
              請保持此頁面開啟。你的 AI 藝術人像通常會在一至兩分鐘內完成。
            </p>
            <div className="progress-track">
              <span />
            </div>
            <p className="progress-label">
              {session?.status === "generating"
                ? "正在描繪最後的細節…"
                : "正在準備你的照片…"}
            </p>
          </div>
        )}
      </section>

      <footer className="mobile-footer">
        照片會經過安全處理，並於期限後自動刪除。
      </footer>
    </main>
  );
}

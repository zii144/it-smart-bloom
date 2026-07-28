import { after } from "next/server";
import QRCode from "qrcode";
import { generateImage } from "@/lib/generate-image";
import {
  parseImageOverrides,
  resolveImageOptions,
} from "@/lib/image-options";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import {
  createSession,
  publicSession,
  purgeExpiredSessions,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return Response.json({ error: "請提供一張照片。" }, { status: 400 });
    }

    const tuningEnabled = isImageTuningEnabled();
    let generationOptions = undefined;
    if (tuningEnabled) {
      const rawOptions = formData.get("imageOptions");
      if (typeof rawOptions === "string" && rawOptions.trim()) {
        try {
          generationOptions = resolveImageOptions(
            parseImageOverrides(JSON.parse(rawOptions)),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "圖片參數無效。";
          return Response.json({ error: message }, { status: 400 });
        }
      }
    }

    const session = await createSession(image, generationOptions);

    // Every capture sweeps the previous guests' expired photos off disk. A
    // booth always takes another photo, so this is the one path guaranteed to
    // run often enough to keep the 15-minute deletion promise.
    after(async () => {
      try {
        await purgeExpiredSessions();
      } catch (error) {
        console.error("Failed to purge expired sessions:", error);
      }
    });

    // The phone is only a viewer: start rendering as soon as the photo exists so
    // the portrait is already on its way while the guest is still scanning the QR.
    // The one exception is the dev tuning modal, which has to pick options first.
    if (generationOptions || !tuningEnabled) {
      after(async () => {
        try {
          await generateImage(session.id, generationOptions ?? null);
        } catch {
          // generateImage already records the failure on the session itself.
        }
      });
    }

    const requestOrigin = new URL(request.url).origin;
    const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
    const baseUrl = (configuredBaseUrl || requestOrigin).replace(/\/+$/, "");
    const sessionUrl = `${baseUrl}/s/${session.id}`;
    const qrDataUrl = await QRCode.toDataURL(sessionUrl, {
      width: 640,
      margin: 2,
      color: {
        dark: "#142c22",
        light: "#fffdf7",
      },
      errorCorrectionLevel: "M",
    });

    return Response.json(
      {
        ...publicSession(session),
        sessionUrl,
        qrDataUrl,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to create session:", error);
    return Response.json(
      { error: "無法建立人像創作連結。" },
      { status: 500 },
    );
  }
}

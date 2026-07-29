import { after } from "next/server";
import QRCode from "qrcode";
import { generateImage } from "@/lib/generate-image";
import {
  parseImageOverrides,
  resolveImageOptions,
} from "@/lib/image-options";
import { archiveSessionCreated } from "@/lib/portrait-archive";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import {
  createSession,
  publicSession,
  readInputImage,
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

    // Persist to Firestore/Storage before the response so other serverless
    // instances (phone poll / image fetch) can find the session. `/tmp` is
    // not shared across Vercel isolates.
    try {
      const input = await readInputImage(session.id);
      await archiveSessionCreated(session, input);
    } catch (error) {
      console.error("Failed to archive session:", error);
      // Still return the booth session when local disk succeeded; generation
      // may keep working on this isolate. Phone recovery needs Firebase though.
    }

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

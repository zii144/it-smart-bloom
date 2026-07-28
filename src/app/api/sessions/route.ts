import QRCode from "qrcode";
import {
  parseImageOverrides,
  resolveImageOptions,
} from "@/lib/image-options";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import { createSession, publicSession, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return Response.json({ error: "請提供一張照片。" }, { status: 400 });
    }

    let generationOptions = undefined;
    if (isImageTuningEnabled()) {
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

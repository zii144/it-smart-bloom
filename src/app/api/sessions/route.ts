import { after } from "next/server";
import QRCode from "qrcode";
import { errorJson, errorResponse } from "@/lib/api-errors";
import { generateImage } from "@/lib/generate-image";
import type { GuestIdentity } from "@/lib/guest-identity";
import { readIdentityToken } from "@/lib/identity-token";
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
} from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return errorJson("IMAGE_REQUIRED", "請提供一張照片。", 400);
    }

    // A raw phone number is never accepted here: an identity only reaches a
    // session through a token issued by /api/identity/verify, which means the
    // person at the booth answered the road-teacher name challenge for it.
    // Absent is allowed (the number is optional); present-but-bad is a 400, and
    // is checked before the photo is written so nothing is left on disk.
    const rawToken = formData.get("identityToken");
    let identity: GuestIdentity | null = null;
    if (typeof rawToken === "string" && rawToken.trim()) {
      identity = readIdentityToken(rawToken.trim());
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
          return errorJson("IMAGE_OPTIONS_INVALID", message, 400);
        }
      }
    }

    const session = await createSession(image, {
      generationOptions,
      identity,
    });

    // Persist to Firestore/Storage before the response so other serverless
    // instances (phone poll / image fetch) can find the session. `/tmp` is
    // not shared across Vercel isolates.
    let identityStored = !identity;
    try {
      const input = await readInputImage(session.id);
      const outcome = await archiveSessionCreated(session, input);
      // Nothing to index without Firebase, and the local copy still works.
      identityStored = !identity || !outcome.archived || outcome.identityIndexed;
    } catch (error) {
      console.error("Failed to archive session:", error);
      // Still return the booth session when local disk succeeded; generation
      // may keep working on this isolate. Phone recovery needs Firebase though.
      identityStored = !identity;
    }

    if (!identityStored) {
      console.error(
        `Session ${session.id} was created but its identity was not indexed.`,
      );
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
        // The number itself never travels back — this payload is the same shape
        // the unauthenticated session GET serves. `false` tells the booth the
        // portrait cannot be matched to its guest later.
        identityStored,
      },
      {
        status: 201,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    return errorResponse(error, "Failed to create session", {
      message: "無法建立人像創作連結。",
    });
  }
}

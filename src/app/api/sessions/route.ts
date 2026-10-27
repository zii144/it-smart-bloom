import { after } from "next/server";
import { isFirebaseConfigured } from "@/lib/firebase-admin";
import { generateImage } from "@/lib/generate-image";
import {
  parseImageOverrides,
  resolveImageOptions,
} from "@/lib/image-options";
import { archiveSessionCreated } from "@/lib/portrait-archive";
import { GuestRosterError, matchGuestOnRoster } from "@/lib/roster-guest";
import {
  PhotoAlreadySubmittedError,
  releasePhotoSubmission,
  reservePhotoSubmission,
  RosterUnavailableError,
} from "@/lib/roster-store";
import {
  brandedQrDataUrl,
  sessionShareUrl,
  shareBaseUrl,
} from "@/lib/session-share";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import {
  createSession,
  deleteSession,
  publicSession,
  purgeExpiredSessions,
  readInputImage,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    // Opportunistic local cleanup; failures must never block a new booth session.
    void purgeExpiredSessions().catch(() => {});

    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return Response.json({ error: "請提供一張照片。" }, { status: 400 });
    }

    // Only guests on the roster get a portrait. Checked here, not just in the
    // booth UI, so calling the API directly cannot skip it.
    const { rosterEntryId } = await matchGuestOnRoster(request, {
      name: formData.get("name"),
      phone: formData.get("phone"),
    });

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

    // One photo per guest: claim it before storing anything, atomically.
    const reservedAt = await reservePhotoSubmission(rosterEntryId);

    let session;
    try {
      session = await createSession(image, generationOptions, undefined, {
        rosterEntryId,
      });

      // Persist to Firestore/Storage before the response so other serverless
      // instances (phone poll / image fetch) can find the session. `/tmp` is
      // not shared across Vercel isolates.
      try {
        const input = await readInputImage(session.id);
        await archiveSessionCreated(session, input);
      } catch (error) {
        console.error("Failed to archive session:", error);
        // When Firebase is configured, a usable QR without an archive is a lie —
        // the phone will 404 on another isolate. Fail closed and drop the local copy.
        if (isFirebaseConfigured()) {
          await deleteSession(session.id).catch(() => {});
          throw new SessionError("無法保存創作空間，請稍後再試。", 503);
        }
      }
    } catch (error) {
      // Nothing was submitted after all (bad file, storage down): give the
      // guest their one submission back.
      await releasePhotoSubmission(rosterEntryId, reservedAt).catch((releaseError) => {
        console.error("Failed to release photo submission:", releaseError);
      });
      throw error;
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

    const sessionUrl = sessionShareUrl(
      shareBaseUrl(new URL(request.url).origin),
      session.id,
    );
    const qrDataUrl = await brandedQrDataUrl(sessionUrl);

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
    if (error instanceof GuestRosterError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PhotoAlreadySubmittedError) {
      return Response.json(
        { error: error.message, alreadySubmitted: true },
        { status: 409 },
      );
    }
    if (error instanceof RosterUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
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

import { adminRouteGuard } from "@/lib/admin-route";
import {
  clearFinalResult,
  finalizeUploadedFinalResult,
  storeFinalResult,
} from "@/lib/portrait-archive";
import { RosterInputError } from "@/lib/roster";
import { rosterJson } from "@/lib/roster-http";
import { recordRosterPortraitAdjusted } from "@/lib/roster-store";
import { readUploadedImage } from "@/lib/sessions";
import { portraitErrorResponse, portraitSessionFor } from "@/lib/portrait-http";

export const runtime = "nodejs";
/** Finalizing reads up to 40 MB from Storage, decodes it and writes it back. */
export const maxDuration = 120;

/**
 * `POST /api/admin30910/roster/:id/portrait` replaces the portrait this guest
 * receives with a fine-tuned version, either way:
 *
 * - JSON `{ objectPath }`: accept a file already PUT to Storage through
 *   `…/portrait/upload-url` (the production path, any size up to the cap);
 * - multipart `image`: the file itself, when URLs cannot be signed. Vercel
 *   rejects bodies over 4.5 MB, so this only suits small files and local dev.
 *
 * Guests who already checked in see it on their next load; their link stays.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const sessionId = await portraitSessionFor(id);

    let finalResult;
    if (request.headers.get("content-type")?.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as {
        objectPath?: unknown;
      } | null;
      finalResult = await finalizeUploadedFinalResult(sessionId, body?.objectPath);
    } else {
      const formData = await request.formData().catch(() => null);
      const image = formData?.get("image");
      if (!(image instanceof File)) {
        throw new RosterInputError("請選擇調整後的圖片。");
      }
      const bytes = await readUploadedImage(image);
      finalResult = await storeFinalResult(sessionId, { bytes, mime: image.type });
    }

    await recordRosterPortraitAdjusted(id, sessionId, finalResult.uploadedAt);
    return rosterJson({ portraitAdjustedAt: finalResult.uploadedAt });
  } catch (error) {
    return portraitErrorResponse(error, "replace guest portrait");
  }
}

/** `DELETE …/portrait`: back to the generated portrait. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const sessionId = await portraitSessionFor(id);
    await clearFinalResult(sessionId);
    await recordRosterPortraitAdjusted(id, sessionId, null);
    return rosterJson({ portraitAdjustedAt: null });
  } catch (error) {
    return portraitErrorResponse(error, "revert guest portrait");
  }
}

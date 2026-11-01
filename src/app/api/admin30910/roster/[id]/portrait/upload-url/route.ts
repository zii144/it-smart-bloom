import { adminRouteGuard } from "@/lib/admin-route";
import { createFinalUploadTarget } from "@/lib/portrait-archive";
import {
  FUNCTION_BODY_SAFE_BYTES,
  isAdjustedMime,
  MAX_ADJUSTED_BYTES,
} from "@/lib/portrait-limits";
import { RosterInputError } from "@/lib/roster";
import { rosterJson } from "@/lib/roster-http";
import { portraitErrorResponse, portraitSessionFor } from "@/lib/portrait-http";

export const runtime = "nodejs";

/**
 * `POST /api/admin30910/roster/:id/portrait/upload-url` with `{ mime, size }`.
 * Replies `{ mode: "signed", uploadUrl, objectPath, contentType }` for a PUT
 * straight to Storage (Vercel caps function bodies at 4.5 MB), or
 * `{ mode: "direct", maxBytes }` where URLs cannot be signed (local
 * emulators): then post the file to `…/portrait` as multipart instead.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      mime?: unknown;
      size?: unknown;
    } | null;
    if (!isAdjustedMime(body?.mime)) {
      throw new RosterInputError("請使用 JPEG、PNG 或 WebP 格式的圖片。");
    }
    const size = body?.size;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      throw new RosterInputError("無法讀取檔案大小，請重新選擇圖片。");
    }
    if (size > MAX_ADJUSTED_BYTES) {
      throw new RosterInputError(`圖片必須小於 ${MAX_ADJUSTED_BYTES / 1024 / 1024} MB。`);
    }

    const sessionId = await portraitSessionFor(id);
    const target = await createFinalUploadTarget(sessionId, body.mime);
    if (!target) {
      return rosterJson({ mode: "direct", maxBytes: FUNCTION_BODY_SAFE_BYTES });
    }
    return rosterJson({ mode: "signed", ...target });
  } catch (error) {
    return portraitErrorResponse(error, "sign adjusted portrait upload");
  }
}

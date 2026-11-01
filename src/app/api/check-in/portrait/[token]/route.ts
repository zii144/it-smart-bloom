import { PreviewError } from "@/lib/portrait-preview";
import {
  originalDownloadResponse,
  previewResponse,
  readPortraitPreview,
} from "@/lib/portrait-delivery";
import {
  findPortraitByAccessToken,
  RosterUnavailableError,
} from "@/lib/roster-store";
import { SessionError } from "@/lib/sessions";

export const runtime = "nodejs";
/** A cold preview may decode a large adjusted original. */
export const maxDuration = 60;

/**
 * `GET /api/check-in/portrait/:token` — a compressed preview of the guest's
 * portrait; `?download=1` is the full-quality original (streamed, or a
 * redirect to a signed Storage URL when it is too big for a function).
 * Unlike `/api/sessions/:id/image` this ignores the 15-minute session expiry:
 * the token from check-in is the permission.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const portrait = await findPortraitByAccessToken(token);
    if (!portrait) {
      return Response.json(
        { error: "這個作品連結已失效，請重新報到後再領取。" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (new URL(request.url).searchParams.get("download") === "1") {
      return await originalDownloadResponse(portrait.sessionId);
    }
    return previewResponse(await readPortraitPreview(portrait.sessionId));
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json(
        {
          error:
            error.status === 503
              ? error.message
              : "目前無法取得作品，請洽現場工作人員。",
        },
        { status: error.status },
      );
    }
    if (error instanceof RosterUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof PreviewError) {
      return Response.json({ error: "目前無法取得作品，請洽現場工作人員。" }, { status: 500 });
    }
    console.error("Failed to serve check-in portrait:", error);
    return Response.json({ error: "無法載入作品。" }, { status: 500 });
  }
}

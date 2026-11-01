import { adminRouteGuard } from "@/lib/admin-route";
import {
  originalDownloadResponse,
  previewResponse,
  readInputPreview,
  readPortraitPreview,
} from "@/lib/portrait-delivery";
import { PreviewError } from "@/lib/portrait-preview";
import { SessionError } from "@/lib/sessions";

export const runtime = "nodejs";
/** A cold preview may decode a large adjusted original. */
export const maxDuration = 60;

/**
 * `GET /api/admin30910/sessions/:id/image?kind=input|result|generated[&original=1]`.
 * `result` is what guests receive; `generated` ignores an admin adjustment.
 * Compressed previews by default; `original=1` is the full-quality file
 * (streamed, or a signed Storage redirect when too big for a function).
 * Works on expired sessions: sessions and images fall back to the archive.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const original = url.searchParams.get("original") === "1";

    if (kind !== "input" && kind !== "result" && kind !== "generated") {
      return Response.json(
        { error: "圖片類型必須是 input、result 或 generated。" },
        { status: 400 },
      );
    }

    if (kind === "input") {
      return previewResponse(await readInputPreview(id), "source-photo.jpg");
    }
    const variant = kind === "result" ? "deliverable" : "generated";
    // Like the old archive fallback: a result stays viewable after a failed retry.
    const options = { allowIncomplete: true };
    if (original) return await originalDownloadResponse(id, variant, options);
    return previewResponse(await readPortraitPreview(id, variant, options));
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json(
        { error: error.status === 503 ? error.message : "目前無法取得圖片。" },
        { status: error.status === 503 ? 503 : 404 },
      );
    }
    if (error instanceof PreviewError) {
      return Response.json({ error: error.message }, { status: 500 });
    }
    console.error("Failed to serve admin archive image:", error);
    return Response.json({ error: "無法載入圖片。" }, { status: 500 });
  }
}

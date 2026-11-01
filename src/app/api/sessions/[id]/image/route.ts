import {
  originalDownloadResponse,
  previewResponse,
  readInputPreview,
  readPortraitPreview,
} from "@/lib/portrait-delivery";
import { PreviewError } from "@/lib/portrait-preview";
import { assertSessionNotExpired, getSession, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * `GET /api/sessions/:id/image?kind=input|result[&download=1]` for the
 * 15-minute guest link. Shows compressed previews; only `kind=result&download=1`
 * returns the full-quality original.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const asDownload = url.searchParams.get("download") === "1";

    if (kind !== "input" && kind !== "result") {
      return Response.json(
        { error: "圖片類型必須是 input 或 result。" },
        { status: 400 },
      );
    }

    const session = await getSession(id);
    assertSessionNotExpired(session);

    if (kind === "input") {
      return previewResponse(await readInputPreview(id), "source-photo.jpg");
    }
    if (asDownload) return await originalDownloadResponse(id);
    return previewResponse(await readPortraitPreview(id));
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof PreviewError) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    console.error("Failed to serve image:", error);
    return Response.json({ error: "無法載入圖片。" }, { status: 500 });
  }
}

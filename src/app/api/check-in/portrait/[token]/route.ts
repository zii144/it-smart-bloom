import {
  findPortraitByAccessToken,
  RosterUnavailableError,
} from "@/lib/roster-store";
import { extensionForMime, readResultImage, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";

/**
 * `GET /api/check-in/portrait/:token[?download=1]` — the finished portrait
 * for a guest who checked in. Unlike `/api/sessions/:id/image` this ignores
 * the 15-minute session expiry: the token from check-in is the permission.
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

    const image = await readResultImage(portrait.sessionId);
    const asDownload = new URL(request.url).searchParams.get("download") === "1";
    const filename = `zhisheng-bloom-portrait.${extensionForMime(image.mime)}`;

    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: "目前無法取得作品，請洽現場工作人員。" }, { status: error.status });
    }
    if (error instanceof RosterUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("Failed to serve check-in portrait:", error);
    return Response.json({ error: "無法載入作品。" }, { status: 500 });
  }
}

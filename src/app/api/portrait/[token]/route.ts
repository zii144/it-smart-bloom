import {
  PortraitTicketError,
  redeemPortraitTicket,
} from "@/lib/portrait-token";
import { readPortraitPreview } from "@/lib/portrait-delivery";
import { PREVIEW_MIME } from "@/lib/portrait-preview";

export const runtime = "nodejs";

/** A link checker must not consume a one-use transfer before RT fetches it. */
export function HEAD() {
  return new Response(null, {
    status: 405,
    headers: { Allow: "GET", "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const headers = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  try {
    const { token } = await params;
    const sessionId = await redeemPortraitTicket(token);
    // An avatar needs no more than the preview, and it always fits a function response.
    const bytes = await readPortraitPreview(sessionId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        ...headers,
        "Content-Type": PREVIEW_MIME,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    const status = error instanceof PortraitTicketError ? error.status : 503;
    return Response.json(
      {
        error:
          status === 404
            ? "圖片連結已失效。"
            : "暫時無法取得圖片，請重新操作。",
      },
      { status, headers },
    );
  }
}

import {
  PortraitTicketError,
  redeemPortraitTicket,
} from "@/lib/portrait-token";
import { readResultImage } from "@/lib/sessions";

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
    const image = await readResultImage(sessionId);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        ...headers,
        "Content-Type": image.mime,
        "Content-Length": String(image.bytes.byteLength),
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

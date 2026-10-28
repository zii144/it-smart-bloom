import { avatarTicketResponse } from "@/lib/avatar-ticket-response";
import { PortraitTicketError } from "@/lib/portrait-token";
import { findPortraitByAccessToken } from "@/lib/roster-store";

export const runtime = "nodejs";

/** The check-in capability replaces the expired 15-minute session link. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const portrait = await findPortraitByAccessToken(token);
    if (!portrait)
      return Response.json(
        { error: "作品連結已失效，請重新報到後再試。" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    return await avatarTicketResponse(request, portrait.sessionId);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PortraitTicketError
            ? error.message
            : "暫時無法建立圖片連結，請稍後再試。",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

import { avatarTicketResponse } from "@/lib/avatar-ticket-response";
import { PortraitTicketError } from "@/lib/portrait-token";
import {
  assertSessionNotExpired,
  getSession,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);
    assertSessionNotExpired(session);
    if (session.status !== "complete")
      return Response.json(
        { error: "人像尚未完成，請稍候再試。" },
        { status: 409 },
      );
    return await avatarTicketResponse(request, id);
  } catch (error) {
    const status =
      error instanceof SessionError || error instanceof PortraitTicketError
        ? error.status
        : 503;
    return Response.json(
      {
        error:
          error instanceof SessionError || error instanceof PortraitTicketError
            ? error.message
            : "暫時無法建立圖片連結，請稍後再試。",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}

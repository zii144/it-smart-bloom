import { mintPortraitTicket, PortraitTicketError } from "@/lib/portrait-token";
import {
  getRoadTeacherConfig,
  isRoadTeacherAvatarEnabled,
} from "@/lib/road-teacher-flags";
import { shareBaseUrl } from "@/lib/session-share";

export async function avatarTicketResponse(
  request: Request,
  sessionId: string,
) {
  if (!isRoadTeacherAvatarEnabled()) throw new PortraitTicketError(404);
  if (!getRoadTeacherConfig()) throw new PortraitTicketError(503);
  const origin = new URL(shareBaseUrl(new URL(request.url).origin));
  if (origin.protocol !== "https:") throw new PortraitTicketError(503);
  const ticket = await mintPortraitTicket(sessionId);
  return Response.json(
    {
      url: new URL(`/api/portrait/${ticket.token}`, origin).toString(),
      expiresAt: ticket.expiresAt,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

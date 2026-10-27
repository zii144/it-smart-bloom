import { adminRouteGuard } from "@/lib/admin-route";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import { allowPhotoResubmission, RosterNotFoundError } from "@/lib/roster-store";

export const runtime = "nodejs";

const ROSTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `DELETE /api/admin30910/roster/:id/submission` — lifts the one-photo limit
 * for this guest so they can submit again. Their current portrait stays
 * until a new one replaces it.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!ROSTER_ID_PATTERN.test(id)) throw new RosterNotFoundError();
    await allowPhotoResubmission(id);
    return rosterJson({ photoSubmittedAt: null });
  } catch (error) {
    return rosterErrorResponse(error, "allow photo resubmission");
  }
}

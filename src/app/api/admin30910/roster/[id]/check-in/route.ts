import { adminRouteGuard } from "@/lib/admin-route";
import { RosterInputError } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  checkInRosterEntry,
  RosterNotFoundError,
  undoRosterCheckIn,
} from "@/lib/roster-store";

export const runtime = "nodejs";

const ROSTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `POST /api/admin30910/roster/:id/check-in` with `{ checkedIn: boolean }`:
 * staff mark a guest arrived (no phone with them) or undo a mistake.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!ROSTER_ID_PATTERN.test(id)) throw new RosterNotFoundError();
    const body = (await request.json().catch(() => null)) as {
      checkedIn?: unknown;
    } | null;
    if (typeof body?.checkedIn !== "boolean") {
      throw new RosterInputError("請指定報到或取消報到。");
    }

    if (body.checkedIn) {
      // The portrait link is the guest's; staff only need the arrival.
      const result = await checkInRosterEntry(id, "admin");
      return rosterJson({
        checkIn: {
          name: result.name,
          seat: result.seat,
          checkedInAt: result.checkedInAt,
          alreadyCheckedIn: result.alreadyCheckedIn,
        },
      });
    }
    await undoRosterCheckIn(id);
    return rosterJson({ checkIn: null });
  } catch (error) {
    return rosterErrorResponse(error, "update guest check-in");
  }
}

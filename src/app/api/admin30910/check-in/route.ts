import { adminRouteGuard } from "@/lib/admin-route";
import { RosterInputError } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import { setCheckInOpen } from "@/lib/roster-store";

export const runtime = "nodejs";

/** `POST /api/admin30910/check-in` with `{ open: boolean }` opens or closes /check-in. */
export async function POST(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => null)) as { open?: unknown } | null;
    if (typeof body?.open !== "boolean") {
      throw new RosterInputError("請指定要開放或關閉報到。");
    }
    return rosterJson({ checkIn: await setCheckInOpen(body.open) });
  } catch (error) {
    return rosterErrorResponse(error, "toggle check-in");
  }
}

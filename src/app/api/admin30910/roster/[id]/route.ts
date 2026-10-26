import { adminRouteGuard } from "@/lib/admin-route";
import { parseRosterInput } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  deleteRosterEntry,
  RosterNotFoundError,
  updateRosterEntry,
} from "@/lib/roster-store";

export const runtime = "nodejs";

/** Firestore auto ids are 20 url-safe characters; reject anything path-like. */
const ROSTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

async function rosterId(params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!ROSTER_ID_PATTERN.test(id)) throw new RosterNotFoundError();
  return id;
}

/** `PATCH /api/admin30910/roster/:id` — replaces every editable field. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const id = await rosterId(params);
    const input = parseRosterInput(await request.json().catch(() => null));
    return rosterJson({ entry: await updateRosterEntry(id, input) });
  } catch (error) {
    return rosterErrorResponse(error, "update roster entry");
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    await deleteRosterEntry(await rosterId(params));
    return rosterJson({ deleted: true });
  } catch (error) {
    return rosterErrorResponse(error, "delete roster entry");
  }
}

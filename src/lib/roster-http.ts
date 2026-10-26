import { RosterInputError } from "@/lib/roster";
import {
  RosterConflictError,
  RosterNotFoundError,
  RosterUnavailableError,
} from "@/lib/roster-store";

const NO_STORE = { "Cache-Control": "no-store" };

export function rosterJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: NO_STORE });
}

/** Maps roster errors to admin API responses; anything else is a 500. */
export function rosterErrorResponse(error: unknown, action: string) {
  if (error instanceof RosterInputError) {
    return rosterJson({ error: error.message }, 400);
  }
  if (error instanceof RosterNotFoundError) {
    return rosterJson({ error: error.message }, 404);
  }
  if (error instanceof RosterConflictError) {
    return rosterJson({ error: error.message }, 409);
  }
  if (error instanceof RosterUnavailableError) {
    return rosterJson({ error: "尚未連線 Firebase，無法管理名單。" }, 503);
  }
  console.error(`Failed to ${action}:`, error);
  return rosterJson({ error: "名單操作失敗，請稍後再試。" }, 500);
}

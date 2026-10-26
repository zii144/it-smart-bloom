import { adminRouteGuard } from "@/lib/admin-route";
import { parseRosterInput } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  createRosterEntry,
  listRosterEntries,
  readCheckInSettings,
  readLastImport,
} from "@/lib/roster-store";

export const runtime = "nodejs";

/** `GET /api/admin30910/roster` — every entry, the last import and check-in state. */
export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const [entries, lastImport, checkIn] = await Promise.all([
      listRosterEntries(),
      readLastImport(),
      readCheckInSettings(),
    ]);
    // Portrait links belong to the guest who checked in; staff never need them.
    const safeEntries = entries.map((entry) => ({
      ...entry,
      portraitAccessToken: undefined,
      portraitAccessExpiresAt: undefined,
    }));
    return rosterJson({ entries: safeEntries, lastImport, checkIn });
  } catch (error) {
    return rosterErrorResponse(error, "list roster");
  }
}

/** `POST /api/admin30910/roster` — add one person by hand. */
export async function POST(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const input = parseRosterInput(await request.json().catch(() => null));
    return rosterJson({ entry: await createRosterEntry(input) }, 201);
  } catch (error) {
    return rosterErrorResponse(error, "create roster entry");
  }
}

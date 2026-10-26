import { adminRouteGuard } from "@/lib/admin-route";
import { parseRosterInput } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  createRosterEntry,
  listRosterEntries,
  readLastImport,
} from "@/lib/roster-store";

export const runtime = "nodejs";

/** `GET /api/admin30910/roster` — every entry plus the last import summary. */
export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const [entries, lastImport] = await Promise.all([
      listRosterEntries(),
      readLastImport(),
    ]);
    return rosterJson({ entries, lastImport });
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

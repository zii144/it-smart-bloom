import { adminRouteGuard } from "@/lib/admin-route";
import { RosterInputError } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  readPhotoSubmissionSettings,
  setPhotoSubmissionsOpen,
} from "@/lib/roster-store";

export const runtime = "nodejs";

/** `GET /api/admin30910/submissions` reports whether guests may submit photos. */
export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    return rosterJson({ submissions: await readPhotoSubmissionSettings() });
  } catch (error) {
    return rosterErrorResponse(error, "read photo submissions");
  }
}

/** `POST /api/admin30910/submissions` with `{ open: boolean }` opens or closes the booth's 欣然赴約. */
export async function POST(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const body = (await request.json().catch(() => null)) as { open?: unknown } | null;
    if (typeof body?.open !== "boolean") {
      throw new RosterInputError("請指定要開放或截止收件。");
    }
    return rosterJson({ submissions: await setPhotoSubmissionsOpen(body.open) });
  } catch (error) {
    return rosterErrorResponse(error, "toggle photo submissions");
  }
}

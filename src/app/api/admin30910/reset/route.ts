import { adminRouteGuard } from "@/lib/admin-route";
import { parseResetRequest, readResetPreview, resetData } from "@/lib/data-reset";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";

export const runtime = "nodejs";
export const maxDuration = 300;

/** `GET /api/admin30910/reset` — what each category holds, and the last reset. */
export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    return rosterJson(await readResetPreview());
  } catch (error) {
    return rosterErrorResponse(error, "read reset preview");
  }
}

/**
 * `POST /api/admin30910/reset` with `{ categories, confirmation: "確認重置" }`.
 * The dashboard downloads a backup first; the server still insists on the
 * typed phrase so a stray request can never wipe anything.
 */
export async function POST(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const categories = parseResetRequest(await request.json().catch(() => null));
    const log = await resetData(categories);
    console.warn("[admin] data reset", JSON.stringify(log));
    return rosterJson({ reset: log });
  } catch (error) {
    return rosterErrorResponse(error, "reset data");
  }
}

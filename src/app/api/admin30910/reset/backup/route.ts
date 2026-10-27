import { adminRouteGuard } from "@/lib/admin-route";
import { buildResetBackup, parseResetCategories } from "@/lib/data-reset";
import { rosterErrorResponse } from "@/lib/roster-http";

export const runtime = "nodejs";

/**
 * `GET /api/admin30910/reset/backup?categories=roster,usage` — a JSON download
 * of everything a reset of those categories would delete or change.
 */
export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const categories = parseResetCategories(
      new URL(request.url).searchParams.get("categories"),
    );
    const backup = await buildResetBackup(categories);
    const stamp = backup.createdAt.replace(/[:.]/g, "-");
    return new Response(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="bloom-backup-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return rosterErrorResponse(error, "build reset backup");
  }
}

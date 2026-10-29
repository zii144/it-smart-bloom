import {
  ADMIN_SESSION_PAGE_SIZE,
  toArchiveRow,
} from "@/lib/admin-dashboard-data";
import { adminRouteGuard } from "@/lib/admin-route";
import { listArchiveSessions } from "@/lib/portrait-archive";

export const runtime = "nodejs";

/** `GET /api/admin30910/archive?before=<createdAt>` — the next older page. */
export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  const before = new URL(request.url).searchParams.get("before");
  const archive = await listArchiveSessions({
    limit: ADMIN_SESSION_PAGE_SIZE,
    before,
  });

  return Response.json(
    { sessions: archive.sessions.map(toArchiveRow), error: archive.error },
    {
      status: archive.error ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

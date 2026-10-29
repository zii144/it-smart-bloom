import { loadAdminDashboard } from "@/lib/admin-dashboard-data";
import { adminRouteGuard } from "@/lib/admin-route";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  return Response.json(await loadAdminDashboard(), {
    headers: { "Cache-Control": "no-store" },
  });
}

import { adminRouteGuard } from "@/lib/admin-route";
import { rebuildSeatStatus } from "@/lib/seat-status-store";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;
  try {
    return Response.json(await rebuildSeatStatus(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "座位看板同步失敗，請重試。" }, { status: 503 });
  }
}

import { displayAdminAuth, displaySessionFromRequest } from "@/lib/seat-status-auth";
import { readSeatStatus } from "@/lib/seat-status-store";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!displaySessionFromRequest(request) && !displayAdminAuth(request).ok) {
    return Response.json({ error: "顯示授權已到期，請重新登入。" }, { status: 401, headers: NO_STORE });
  }
  try {
    return Response.json(await readSeatStatus(), { headers: NO_STORE });
  } catch {
    return Response.json({ error: "暫時無法讀取座位資料。" }, { status: 503, headers: NO_STORE });
  }
}

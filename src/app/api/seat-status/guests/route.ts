import { displayAdminAuth, displaySessionFromRequest } from "@/lib/seat-status-auth";
import { MAX_SEAT_GUEST_LOOKUP, normalizeSeatLabel } from "@/lib/seat-status";
import { readSeatGuests } from "@/lib/seat-guest-store";

export const runtime = "nodejs";
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  if (!displaySessionFromRequest(request) && !displayAdminAuth(request).ok) {
    return Response.json({ error: "顯示授權已到期，請重新登入。" }, { status: 401, headers: NO_STORE });
  }
  const params = new URL(request.url).searchParams;
  const seat = normalizeSeatLabel(params.get("seat") ?? "");
  const ids = [...new Set((params.get("ids") ?? "").split(","))];
  if (!seat || seat.length > 500 || !ids.length || ids.length > MAX_SEAT_GUEST_LOOKUP || ids.some((id) => !/^[A-Za-z0-9_-]{1,64}$/.test(id))) {
    return Response.json({ error: "座位查詢格式不正確。" }, { status: 400, headers: NO_STORE });
  }
  try {
    return Response.json({ guests: await readSeatGuests(seat, ids) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "暫時無法讀取來賓資料，請稍後重試。" }, { status: 503, headers: NO_STORE });
  }
}

import { GuestRosterError, matchGuestOnRoster } from "@/lib/roster-guest";
import { RosterUnavailableError } from "@/lib/roster-store";

export const runtime = "nodejs";

/**
 * Lets the booth tell a guest they are not on the roster before they pick a
 * photo. `POST /api/sessions` repeats the check, so skipping this call gains
 * nothing. The reply never includes any roster data.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      phone?: unknown;
    } | null;
    await matchGuestOnRoster(request, {
      name: body?.name,
      phone: body?.phone,
    });
    return Response.json(
      { matched: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GuestRosterError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof RosterUnavailableError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("Failed to verify roster guest:", error);
    return Response.json(
      { error: "暫時無法確認報名資料，請稍後再試。" },
      { status: 500 },
    );
  }
}

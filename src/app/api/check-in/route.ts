import { GuestRosterError, matchGuestOnRoster } from "@/lib/roster-guest";
import {
  checkInRosterEntry,
  readCheckInSettings,
  RosterNotFoundError,
  RosterUnavailableError,
} from "@/lib/roster-store";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * `POST /api/check-in` with `{ name, phone }`. Same 姓名 + 手機 match as the
 * booth; only works while an admin has check-in open. Replies with the
 * guest's own name, seat, arrival time and — once it is finished — a private
 * link to their portrait. Nothing else from the roster.
 */
export async function POST(request: Request) {
  try {
    const settings = await readCheckInSettings();
    if (!settings.open) {
      return Response.json(
        { error: "報到尚未開放，請於活動當天現場報到。", closed: true },
        { status: 403, headers: NO_STORE },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      phone?: unknown;
    } | null;
    const { rosterEntryId } = await matchGuestOnRoster(request, {
      name: body?.name,
      phone: body?.phone,
    });
    const { portrait, ...arrival } = await checkInRosterEntry(rosterEntryId, "self");
    return Response.json(
      {
        ...arrival,
        portrait: {
          status: portrait.status,
          url: portrait.accessToken
            ? `/api/check-in/portrait/${portrait.accessToken}`
            : null,
        },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof GuestRosterError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: NO_STORE },
      );
    }
    if (error instanceof RosterNotFoundError) {
      // Deleted between the match and the write: same answer as no match.
      return Response.json(
        { error: "找不到你的報名資料，請洽現場工作人員。" },
        { status: 403, headers: NO_STORE },
      );
    }
    if (error instanceof RosterUnavailableError) {
      return Response.json({ error: error.message }, { status: 503, headers: NO_STORE });
    }
    console.error("Failed to check in guest:", error);
    return Response.json(
      { error: "暫時無法完成報到，請洽現場工作人員。" },
      { status: 500, headers: NO_STORE },
    );
  }
}

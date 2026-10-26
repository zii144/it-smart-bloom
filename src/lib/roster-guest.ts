import {
  isValidGuestName,
  isValidMobile,
  normalizeGuestName,
  normalizeMobile,
} from "@/lib/guest-identity";
import {
  isRosterGuessBlocked,
  recordRosterFailure,
  rosterClientKey,
} from "@/lib/roster-attempts";
import { findRosterMatch } from "@/lib/roster-store";

export class GuestRosterError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GuestRosterError";
  }
}

/**
 * Confirms the guest is on the roster and returns their roster entry id.
 * Throws `GuestRosterError` with a guest-facing message otherwise; Firebase
 * being unavailable surfaces as `RosterUnavailableError` from the store.
 */
export async function matchGuestOnRoster(
  request: Request,
  input: { name: unknown; phone: unknown },
): Promise<{ rosterEntryId: string }> {
  const name =
    typeof input.name === "string" ? normalizeGuestName(input.name) : "";
  const phone =
    typeof input.phone === "string" ? normalizeMobile(input.phone) : "";

  if (!isValidGuestName(name)) {
    throw new GuestRosterError("請填寫姓名。", 400);
  }
  if (!isValidMobile(phone)) {
    throw new GuestRosterError(
      "電話號碼需為 09 開頭的 10 碼手機號碼，例如 0912345678。",
      400,
    );
  }

  const client = rosterClientKey(request);
  if (isRosterGuessBlocked(client, name)) {
    throw new GuestRosterError(
      "嘗試次數過多，請稍候幾分鐘或洽現場工作人員。",
      429,
    );
  }

  const match = await findRosterMatch(name, phone);
  if (!match) {
    recordRosterFailure(client, name);
    throw new GuestRosterError(
      "找不到你的報名資料，請確認姓名與手機號碼，或洽現場工作人員。",
      403,
    );
  }

  return { rosterEntryId: match.id };
}

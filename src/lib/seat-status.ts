/** Minimal live display feed. Guest details are authorized separately on demand. */
export const SEAT_STATUS_COLLECTION = "seatStatus";
export const SEAT_STATUS_META_COLLECTION = "seatStatusMeta";
export type SeatStatusEntry = { id: string; seat: string; checkedInAt: string | null };
/** Fetched separately for an authorized seat hover; never part of the live feed. */
export type SeatGuest = { id: string; name: string; role: string; seat: string; checkedInAt: string | null };
export const MAX_SEAT_GUEST_LOOKUP = 100;

export function normalizeSeatLabel(label: string) {
  return label.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
}
export type SeatStatusSettings = { open: boolean; updatedAt: string | null };
export type SeatStatusSnapshot = {
  entries: SeatStatusEntry[];
  checkIn: SeatStatusSettings;
  verifiedAt: string;
};

export function seatStatusData(entry: { seat?: unknown; checkedInAt?: unknown }) {
  return {
    seat: typeof entry.seat === "string" ? entry.seat : "",
    checkedInAt: typeof entry.checkedInAt === "string" ? entry.checkedInAt : null,
  };
}

export type DisplaySeat = {
  label: string;
  section: string;
  assigned: number;
  arrived: number;
  checkedInAt: string | null;
};

export function buildSeatBoard(entries: SeatStatusEntry[]) {
  const seats = new Map<string, DisplaySeat>();
  let arrived = 0;
  let unassigned = 0;
  for (const entry of entries) {
    if (entry.checkedInAt) arrived++;
    const label = normalizeSeatLabel(entry.seat);
    if (!label) {
      unassigned++;
      continue;
    }
    const current = seats.get(label) ?? {
      label,
      section: label.match(/^(.*?)[\s-]*\d+$/)?.[1] || "其他",
      assigned: 0,
      arrived: 0,
      checkedInAt: null,
    };
    current.assigned++;
    if (entry.checkedInAt) {
      current.arrived++;
      if (!current.checkedInAt || entry.checkedInAt > current.checkedInAt) {
        current.checkedInAt = entry.checkedInAt;
      }
    }
    seats.set(label, current);
  }
  const sorted = [...seats.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "zh-TW", { numeric: true }),
  );
  return {
    seats: sorted,
    total: entries.length,
    arrived,
    waiting: entries.length - arrived,
    unassigned,
    conflicts: sorted.filter((seat) => seat.assigned > 1).length,
    sections: [...new Set(sorted.map((seat) => seat.section))],
    recent: sorted.filter((seat) => seat.checkedInAt)
      .sort((a, b) => b.checkedInAt!.localeCompare(a.checkedInAt!)).slice(0, 5),
  };
}

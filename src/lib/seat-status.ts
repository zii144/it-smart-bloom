/** The entire browser-readable display contract. Never add private roster fields. */
export const SEAT_STATUS_COLLECTION = "seatStatus";
export const SEAT_STATUS_META_COLLECTION = "seatStatusMeta";
export type SeatStatusEntry = { id: string; seat: string; checkedInAt: string | null };
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
    const label = entry.seat.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
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

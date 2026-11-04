/** Coordinates transcribed from the reference's 418 × 745 venue drawing. */
export const FLOOR_PLAN_COLUMNS = [57, 81, 105, 129, 174, 198, 222, 246, 289, 313, 337, 361];
export const FLOOR_PLAN_ROWS = [
  { label: "A", y: 175 }, { label: "B", y: 210 }, { label: "C", y: 245 },
  { label: "D", y: 294 }, { label: "E", y: 329 }, { label: "F", y: 364 },
  { label: "G", y: 399 }, { label: "H", y: 434 }, { label: "I", y: 469 },
  { label: "J", y: 504 }, { label: "K", y: 554 }, { label: "L", y: 589 },
  { label: "M", y: 624 }, { label: "N", y: 659 }, { label: "O", y: 694 },
] as const;
export const FLOOR_PLAN_SEATS = FLOOR_PLAN_ROWS.flatMap((row) =>
  FLOOR_PLAN_COLUMNS.map((x, column) => ({ label: `${row.label}${column + 1}`, x, y: row.y })),
);
export const FLOOR_PLAN_LABELS = new Set(FLOOR_PLAN_SEATS.map((seat) => seat.label));

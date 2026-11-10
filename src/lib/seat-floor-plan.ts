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

/**
 * The same venue re-flowed for a 16:9 screen, in a 1600 × 900 drawing that
 * fills the screen. Order, blocks and aisles match the reference;
 * only the proportions change so seats can be wide enough to read.
 */
export const WIDE_PLAN_COLUMNS = [130, 236, 342, 448, 614, 720, 826, 932, 1098, 1204, 1310, 1416];
export const WIDE_PLAN_ROW_Y = [188, 232, 276, 338, 382, 426, 470, 514, 558, 602, 664, 708, 752, 796, 840];

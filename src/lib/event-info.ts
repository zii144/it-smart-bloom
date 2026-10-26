/** The 成果展 itself — one place for every page that prints the invitation. */
export const EVENT_INFO = {
  organizer: "交通部",
  program: ["114至115年高齡者交通安全教育－", "路老師培訓宣講計畫"],
  date: "115年11月10日 星期二",
  time: "14:00–15:30",
  venue: "晶宴會館—民權館",
  address: "臺北市中山區江寧里民權東路三段2號B1",
} as const;

/** 活動流程 (event rundown) shared on Google Drive; the success card's QR opens it. */
export const EVENT_RUNDOWN_URL =
  "https://drive.google.com/drive/folders/10e-ui7G2bgnJMb_hZSzl7Ju0ziQeahwK?usp=drive_link";

const TAIPEI_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * Taiwan-time parts built by hand: locale output varies between ICU versions
 * (thin spaces, 上午/下午), and these strings end up in CSV reports.
 */
function taipeiParts(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = Object.fromEntries(
    TAIPEI_PARTS.formatToParts(new Date(ms)).map((part) => [part.type, part.value]),
  );
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** Event-day clock, e.g. `14:02`. */
export function formatTaipeiTime(iso: string) {
  const parts = taipeiParts(iso);
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

/**
 * e.g. `10/27 07:05`. Rendered on the server and in the browser, so it must
 * not depend on either one's timezone or ICU build (hydration would differ).
 */
export function formatTaipeiShort(iso: string) {
  const parts = taipeiParts(iso);
  return parts ? `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}` : iso;
}

/** e.g. `2026/11/10 14:02:30`. */
export function formatTaipeiDateTime(iso: string) {
  const parts = taipeiParts(iso);
  return parts
    ? `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
    : "";
}

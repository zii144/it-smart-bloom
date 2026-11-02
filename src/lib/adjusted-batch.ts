import { isAdjustedMime, MAX_ADJUSTED_BYTES } from "@/lib/portrait-limits";
import type { RosterEntry } from "@/lib/roster";

/**
 * Batch retouching, in the browser: staff download every original named
 * `{座位}_{姓名}_{來賓編號}.jpg`, retouch them keeping the name, and upload
 * the folder back. Matching by file name is the only thing standing between
 * a portrait and the wrong guest, so every doubt is shown before upload.
 */
export type PortraitGuest = Pick<
  RosterEntry,
  "id" | "name" | "seat" | "portraitStatus" | "portraitSessionId" | "portraitAdjustedAt"
>;

export function hasPortrait<T extends PortraitGuest>(
  entry: T,
): entry is T & { portraitSessionId: string } {
  return entry.portraitStatus === "complete" && Boolean(entry.portraitSessionId);
}

/** Keeps file names portable across Windows, macOS and retouching apps. */
function filePart(value: string) {
  return value.normalize("NFKC").replace(/[\\/:*?"<>|\s_]+/g, "").slice(0, 40);
}

function seatKey(seat: string) {
  return seat.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

export function originalFilename(entry: PortraitGuest, extension: string) {
  const seat = filePart(entry.seat ?? "") || "無座位";
  const name = filePart(entry.name) || "來賓";
  return `${seat}_${name}_${entry.id}.${extension}`;
}

export function extensionForType(type: string | null) {
  if (type?.includes("png")) return "png";
  if (type?.includes("webp")) return "webp";
  return "jpg";
}

export type UploadFile = { name: string; type: string; size: number };

export type UploadPlanRow = {
  fileName: string;
  guest: PortraitGuest | null;
  matchedBy: "id" | "seat" | null;
  /** Set when this file must not be uploaded. */
  problem: string | null;
  /** The guest already has an adjustment that this would replace. */
  replaces: boolean;
};

/**
 * One row per file, in the order given. A file matches by the full guest id
 * anywhere in its name (what the download names it), or else by the seat
 * before the first `_`, `-`, space or dot (for hand-named files like `L5.jpg`).
 */
export function planAdjustedUploads(
  files: UploadFile[],
  guests: PortraitGuest[],
): UploadPlanRow[] {
  const bySeat = new Map<string, PortraitGuest[]>();
  for (const guest of guests) {
    if (!guest.seat) continue;
    const key = seatKey(guest.seat);
    bySeat.set(key, [...(bySeat.get(key) ?? []), guest]);
  }

  const rows = files.map((file): UploadPlanRow => {
    const base = file.name.replace(/\.[^.]+$/, "");
    const row: UploadPlanRow = {
      fileName: file.name,
      guest: null,
      matchedBy: null,
      problem: null,
      replaces: false,
    };

    const byId = guests.find((guest) => guest.id.length >= 8 && base.includes(guest.id));
    if (byId) {
      row.guest = byId;
      row.matchedBy = "id";
    } else {
      const token = seatKey(base.split(/[_\-\s.]/)[0] ?? "");
      const seated = token ? (bySeat.get(token) ?? []) : [];
      if (seated.length > 1) {
        row.problem = "這個座位有多位來賓，請保留下載時檔名裡的來賓編號。";
        return row;
      }
      if (seated.length === 1) {
        row.guest = seated[0];
        row.matchedBy = "seat";
      }
    }

    if (!row.guest) {
      row.problem = "對不到來賓：檔名請保留下載時的名稱，或以座位開頭（例如 L5_…）。";
    } else if (!hasPortrait(row.guest)) {
      row.problem = "這位來賓沒有完成的作品，不能上傳調整版。";
    } else if (!isAdjustedMime(file.type)) {
      row.problem = "格式不支援，請匯出成 JPEG、PNG 或 WebP（不支援 HEIC、PSD）。";
    } else if (file.size <= 0 || file.size > MAX_ADJUSTED_BYTES) {
      row.problem = `檔案必須小於 ${MAX_ADJUSTED_BYTES / 1024 / 1024} MB。`;
    } else {
      row.replaces = Boolean(row.guest.portraitAdjustedAt);
    }
    return row;
  });

  // Two uploadable files for one guest: whichever went last would silently
  // win. A file already refused for another reason never uploads, so it
  // does not block the good one.
  const targets = new Map<string, number>();
  for (const row of rows) {
    if (row.guest && !row.problem) {
      targets.set(row.guest.id, (targets.get(row.guest.id) ?? 0) + 1);
    }
  }
  for (const row of rows) {
    if (row.guest && !row.problem && (targets.get(row.guest.id) ?? 0) > 1) {
      row.problem = "多個檔案對到同一位來賓，請只保留一個。";
    }
  }
  return rows;
}

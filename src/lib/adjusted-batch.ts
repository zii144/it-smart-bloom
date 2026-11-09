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

/** A render that failed: an uploaded adjustment completes it, no regeneration needed. */
export function hasFailedPortrait(entry: PortraitGuest) {
  return entry.portraitStatus === "failed" && Boolean(entry.portraitSessionId);
}

/** Never sent a photo: an uploaded image becomes their portrait. */
export function hasNoPortrait(entry: PortraitGuest) {
  return !entry.portraitSessionId;
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
  matchedBy: "id" | "seat" | "name" | null;
  /** Set when this file must not be uploaded. */
  problem: string | null;
  /** The guest already has an adjustment that this would replace. */
  replaces: boolean;
  /** The guest's render failed; this file becomes their portrait. */
  completesFailed: boolean;
  /** The guest never sent a photo; this file becomes their portrait. */
  createsPortrait: boolean;
};

/** Candidate seat or name strings in a hand-made file name, most specific first. */
function nameCandidates(base: string) {
  const whole = base.normalize("NFKC").trim();
  // Hyphens split last: `B-12 修` must try `B-12` before it could fall to `B`.
  return [
    ...new Set([
      whole,
      whole.split("_")[0],
      whole.split(/[_\s]/)[0],
      whole.split(/[_\-\s.]/)[0],
    ]),
  ].filter(Boolean);
}

function nameKey(name: string) {
  return name.normalize("NFKC").replace(/[\s_]+/g, "");
}

/**
 * One row per file, in the order given. A file matches by the full guest id
 * anywhere in its name (what the download names it). Otherwise, for
 * hand-named files, by seat (`L5.jpg`, `B-12.jpg`, `L5_final.png`), then by
 * a guest name that only one guest has (`王小明.jpg`). Never by guesswork:
 * a seat or name shared by two guests is refused.
 */
export function planAdjustedUploads(
  files: UploadFile[],
  guests: PortraitGuest[],
): UploadPlanRow[] {
  const bySeat = new Map<string, PortraitGuest[]>();
  const byName = new Map<string, PortraitGuest[]>();
  for (const guest of guests) {
    if (guest.seat) {
      const key = seatKey(guest.seat);
      bySeat.set(key, [...(bySeat.get(key) ?? []), guest]);
    }
    const key = nameKey(guest.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), guest]);
  }

  const rows = files.map((file): UploadPlanRow => {
    const base = file.name.replace(/\.[^.]+$/, "");
    const row: UploadPlanRow = {
      fileName: file.name,
      guest: null,
      matchedBy: null,
      problem: null,
      replaces: false,
      completesFailed: false,
      createsPortrait: false,
    };

    const byId = guests.find((guest) => guest.id.length >= 8 && base.includes(guest.id));
    if (byId) {
      row.guest = byId;
      row.matchedBy = "id";
    } else {
      const candidates = nameCandidates(base);
      const seated = candidates
        .map((candidate) => bySeat.get(seatKey(candidate)) ?? [])
        .find((found) => found.length > 0) ?? [];
      const named = seated.length
        ? []
        : (candidates
            .map((candidate) => byName.get(nameKey(candidate)) ?? [])
            .find((found) => found.length > 0) ?? []);
      if (seated.length > 1) {
        row.problem = "這個座位有多位來賓，請保留下載時檔名裡的來賓編號。";
        return row;
      }
      if (named.length > 1) {
        row.problem = "有多位來賓同名，請保留下載時檔名裡的來賓編號。";
        return row;
      }
      if (seated.length === 1) {
        row.guest = seated[0];
        row.matchedBy = "seat";
      } else if (named.length === 1) {
        row.guest = named[0];
        row.matchedBy = "name";
      }
    }

    if (!row.guest) {
      row.problem = "對不到來賓：檔名請保留下載時的名稱，或用座位、姓名命名（例如 L5.jpg）。";
    } else if (!hasPortrait(row.guest) && !hasFailedPortrait(row.guest) && !hasNoPortrait(row.guest)) {
      row.problem = "這位來賓的作品仍在生成中，請稍後再上傳。";
    } else if (!isAdjustedMime(file.type)) {
      row.problem = "格式不支援，請匯出成 JPEG、PNG 或 WebP（不支援 HEIC、PSD）。";
    } else if (file.size <= 0 || file.size > MAX_ADJUSTED_BYTES) {
      row.problem = `檔案必須小於 ${MAX_ADJUSTED_BYTES / 1024 / 1024} MB。`;
    } else if (hasFailedPortrait(row.guest)) {
      row.completesFailed = true;
    } else if (hasNoPortrait(row.guest)) {
      row.createsPortrait = true;
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

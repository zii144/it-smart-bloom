/**
 * Shared helpers for the adjusted-portrait scripts. Plain Node (>= 20), no
 * dependencies, so an agent can run them from any checkout.
 *
 * File naming and matching MUST stay identical to the admin panel
 * (src/lib/adjusted-batch.ts); tests/skill-adjusted-portraits.test.ts checks
 * the two agree on the same inputs.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const BASE_URL = (process.env.BLOOM_BASE_URL || "https://it-smart-bloom.vercel.app").replace(
  /\/$/,
  "",
);
export const MAX_ADJUSTED_BYTES = 40 * 1024 * 1024;
const ADJUSTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MIME_BY_EXTENSION = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".psd": "image/vnd.adobe.photoshop",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};
const README_NAME = "說明.txt";

/**
 * Failures that would hit every remaining file the same way (network,
 * Storage/CORS, the session, URL signing). Same rule as the admin panel.
 */
export const STOP_THE_RUN = /儲存空間|網路|CORS|Unauthorized|Forbidden|此環境只能上傳/;

// —— Admin API ——

function authorization() {
  const secret = process.env.BLOOM_ADMIN_SECRET;
  if (!secret) {
    throw new Error("請先設定環境變數 BLOOM_ADMIN_SECRET（後台管理密碼）。不要把密碼寫進指令或檔案。");
  }
  return `Basic ${Buffer.from(`admin:${secret}`).toString("base64")}`;
}

/** Fetch an admin route. Basic auth, no Origin header (the API's same-origin lock passes). */
export async function api(route, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", authorization());
  return fetch(`${BASE_URL}${route}`, { ...init, headers });
}

export async function readError(response) {
  const body = await response.json().catch(() => null);
  return body?.error || `操作失敗（HTTP ${response.status}）`;
}

export async function apiJson(route, init) {
  const response = await api(route, init);
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

export async function loadRoster() {
  const { entries, checkIn } = await apiJson("/api/admin30910/roster");
  return { entries, checkIn };
}

export async function loadSubmissions() {
  const { submissions } = await apiJson("/api/admin30910/submissions");
  return submissions;
}

// —— Naming and matching (mirror of src/lib/adjusted-batch.ts) ——

export function hasPortrait(entry) {
  return entry.portraitStatus === "complete" && Boolean(entry.portraitSessionId);
}

function filePart(value) {
  return value.normalize("NFKC").replace(/[\\/:*?"<>|\s_]+/g, "").slice(0, 40);
}

function seatKey(seat) {
  return seat.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

export function originalFilename(entry, extension) {
  const seat = filePart(entry.seat ?? "") || "無座位";
  const name = filePart(entry.name) || "來賓";
  return `${seat}_${name}_${entry.id}.${extension}`;
}

export function extensionForType(type) {
  if (type?.includes("png")) return "png";
  if (type?.includes("webp")) return "webp";
  return "jpg";
}

function nameCandidates(base) {
  const whole = base.normalize("NFKC").trim();
  return [
    ...new Set([
      whole,
      whole.split("_")[0],
      whole.split(/[_\s]/)[0],
      whole.split(/[_\-\s.]/)[0],
    ]),
  ].filter(Boolean);
}

function nameKey(name) {
  return name.normalize("NFKC").replace(/[\s_]+/g, "");
}

/** files: [{ name, type, size }]; guests: roster entries. One row per file, in order. */
export function planAdjustedUploads(files, guests) {
  const bySeat = new Map();
  const byName = new Map();
  for (const guest of guests) {
    if (guest.seat) {
      const key = seatKey(guest.seat);
      bySeat.set(key, [...(bySeat.get(key) ?? []), guest]);
    }
    const key = nameKey(guest.name);
    if (key) byName.set(key, [...(byName.get(key) ?? []), guest]);
  }

  const rows = files.map((file) => {
    const base = file.name.replace(/\.[^.]+$/, "");
    const row = { fileName: file.name, guest: null, matchedBy: null, problem: null, replaces: false };

    const byId = guests.find((guest) => guest.id.length >= 8 && base.includes(guest.id));
    if (byId) {
      row.guest = byId;
      row.matchedBy = "id";
    } else {
      const candidates = nameCandidates(base);
      const seated =
        candidates.map((candidate) => bySeat.get(seatKey(candidate)) ?? []).find((found) => found.length > 0) ??
        [];
      const named = seated.length
        ? []
        : (candidates.map((candidate) => byName.get(nameKey(candidate)) ?? []).find((found) => found.length > 0) ??
          []);
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
    } else if (!hasPortrait(row.guest)) {
      row.problem = "這位來賓沒有完成的作品，不能上傳調整版。";
    } else if (!ADJUSTED_MIME_TYPES.has(file.type)) {
      row.problem = "格式不支援，請匯出成 JPEG、PNG 或 WebP（不支援 HEIC、PSD）。";
    } else if (file.size <= 0 || file.size > MAX_ADJUSTED_BYTES) {
      row.problem = `檔案必須小於 ${MAX_ADJUSTED_BYTES / 1024 / 1024} MB。`;
    } else {
      row.replaces = Boolean(row.guest.portraitAdjustedAt);
    }
    return row;
  });

  const targets = new Map();
  for (const row of rows) {
    if (row.guest && !row.problem) targets.set(row.guest.id, (targets.get(row.guest.id) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row.guest && !row.problem && (targets.get(row.guest.id) ?? 0) > 1) {
      row.problem = "多個檔案對到同一位來賓，請只保留一個。";
    }
  }
  return rows;
}

// —— Local files ——

/** The browser's notion of a file's type comes from its extension; so does ours. */
export function mimeForName(name) {
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? "";
}

/** Every candidate file under `dir`, recursively; hidden files and 說明.txt skipped. */
export async function listCandidateFiles(dir) {
  const found = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === README_NAME) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        found.push({ path: full, name: entry.name, type: mimeForName(entry.name), size: (await stat(full)).size });
      }
    }
  }
  await walk(dir);
  return found.sort((a, b) => a.name.localeCompare(b.name, "zh-TW", { numeric: true }));
}

// —— CLI helpers ——

export function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

export function guestLabel(guest) {
  return `${guest.seat || "無座位"}・${guest.name}`;
}

/** Runs `task` over `items` with at most `limit` at once; `shouldStop()` halts new work. */
export async function runPool(items, limit, task, shouldStop = () => false) {
  const queue = [...items];
  async function worker() {
    for (let item = queue.shift(); item !== undefined && !shouldStop(); item = queue.shift()) {
      await task(item);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
}

export async function main(run) {
  try {
    await run(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`錯誤：${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

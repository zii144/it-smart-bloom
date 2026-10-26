/**
 * Guest roster: parsing the admin's Excel sheet and planning how it merges
 * into the Firestore `roster` collection. Everything here is pure so the
 * import rules can be tested without Firebase; `roster-store.ts` does the I/O.
 *
 * Guests are matched on 姓名 + 手機 together (`matchKey`). Every other column
 * is kept for admin use only and never shown to guests.
 */

export const ROSTER_TEXT_FIELDS = [
  { key: "seat", label: "座位", headers: ["座位"] },
  { key: "tag", label: "標籤", headers: ["標籤"] },
  { key: "role", label: "身分", headers: ["身分", "身份"] },
  {
    key: "email",
    label: "電子郵件",
    headers: ["電子郵件", "email", "e-mail", "信箱"],
  },
  { key: "address", label: "地址", headers: ["地址"] },
  { key: "officialDoc", label: "公文", headers: ["公文", "公文申請"] },
  { key: "note", label: "備註", headers: ["備註"] },
  { key: "vest", label: "背心", headers: ["背心", "背心尺寸"] },
  { key: "mealGroup", label: "飯友", headers: ["飯友"] },
] as const;

export const ROSTER_NUMBER_FIELDS = [
  { key: "mentorSubsidy", label: "導師補助", headers: ["導師補助"] },
  { key: "teamGuest", label: "團隊貴賓", headers: ["團隊貴賓"] },
] as const;

const NAME_HEADERS = ["姓名"];
const MOBILE_HEADERS = ["手機", "手機號碼", "行動電話", "電話", "電話號碼"];
/**
 * Identity-document and bank columns are never imported, even when filled in:
 * the booth has no use for them and they must not end up in Firestore.
 */
const SENSITIVE_HEADERS = ["身分證正面", "身分證反面", "身分證", "存摺"];

export const MAX_ROSTER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROSTER_ROWS = 5000;
const MAX_NAME_LENGTH = 60;
const MAX_TEXT_LENGTH = 500;
const MAX_EXTRA_KEYS = 30;
/** How far down the sheet to look for the header row. */
const HEADER_SCAN_ROWS = 10;

export type RosterTextKey = (typeof ROSTER_TEXT_FIELDS)[number]["key"];
export type RosterNumberKey = (typeof ROSTER_NUMBER_FIELDS)[number]["key"];

export type RosterFields = Record<RosterTextKey, string> &
  Record<RosterNumberKey, number | null>;

/** What the admin can edit on one person. */
export type RosterInput = RosterFields & {
  name: string;
  /** Normalized `09xxxxxxxx`, or null when unknown (the person cannot match). */
  mobile: string | null;
  extra: Record<string, string>;
};

export type CheckInSource = "self" | "admin";
export type PortraitStatus = "ready" | "generating" | "complete" | "failed";

/**
 * Event-day state kept on the entry. Imports and admin edits never write
 * these, so they survive re-imports. Older documents simply lack them.
 */
export type RosterEventState = {
  checkedInAt?: string | null;
  checkInSource?: CheckInSource | null;
  /** The guest's most recent booth session and how far it got. */
  portraitSessionId?: string | null;
  portraitStatus?: PortraitStatus | null;
  portraitUpdatedAt?: string | null;
  /**
   * Handed out by a valid check-in so the guest can collect their finished
   * portrait; session links expire long before event day.
   */
  portraitAccessToken?: string | null;
  portraitAccessExpiresAt?: string | null;
};

/** Stored Firestore document (`roster/{id}`). */
export type RosterEntryData = RosterInput &
  RosterEventState & {
    nameKey: string;
    matchKey: string | null;
    source: "import" | "admin";
    createdAt: string;
    updatedAt: string;
  };

export type RosterEntry = RosterEntryData & { id: string };

export class RosterInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterInputError";
  }
}

// —— Normalization ——

function compactHeader(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** Display form: NFKC, trimmed, inner whitespace collapsed. */
export function cleanRosterName(raw: string) {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Comparison form: whitespace never distinguishes two names. */
export function rosterNameKey(raw: string) {
  return raw.normalize("NFKC").replace(/\s+/g, "");
}

/**
 * Accepts what people and spreadsheets actually produce — `0912-345-678`,
 * `0912 345 678`, `+886 912 345 678`, or a number cell that lost its leading
 * zero (`912345678`) — and returns `09xxxxxxxx`, or null when it is not a
 * Taiwan mobile number.
 */
export function normalizeRosterMobile(raw: unknown): string | null {
  let text: string;
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0) return null;
    text = String(raw);
  } else if (typeof raw === "string") {
    text = raw.normalize("NFKC");
  } else {
    return null;
  }

  let digits = text.replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("886")) digits = `0${digits.slice(3)}`;
  if (/^9\d{8}$/.test(digits)) digits = `0${digits}`;
  return /^09\d{8}$/.test(digits) ? digits : null;
}

export function rosterMatchKey(name: string, mobile: string | null) {
  const nameKey = rosterNameKey(name);
  if (!nameKey || !mobile) return null;
  return `${nameKey}|${mobile}`;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value).normalize("NFKC").trim();
}

function cellNumber(value: unknown): number | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : "invalid";
  const text = cellText(value).replace(/[,\s]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

export function emptyRosterFields(): RosterFields {
  const fields = {} as RosterFields;
  for (const field of ROSTER_TEXT_FIELDS) fields[field.key] = "";
  for (const field of ROSTER_NUMBER_FIELDS) fields[field.key] = null;
  return fields;
}

// —— Workbook parsing ——

export type RosterSheet = { sheet: string; data: unknown[][] };

export type ParsedRosterRow = {
  /** 1-based row number as Excel shows it, for messages to the admin. */
  row: number;
  name: string;
  nameKey: string;
  mobile: string | null;
  /** The cell as typed, so the admin can see why a number was rejected. */
  mobileRaw: string;
  fields: RosterFields;
  extra: Record<string, string>;
};

export type RosterIssue = {
  row: number;
  name: string;
  level: "skipped" | "warning";
  message: string;
};

export type ParsedRoster = {
  sheet: string;
  rows: ParsedRosterRow[];
  issues: RosterIssue[];
  ignoredColumns: string[];
};

type ColumnRole =
  | { kind: "name" }
  | { kind: "mobile" }
  | { kind: "text"; key: RosterTextKey }
  | { kind: "number"; key: RosterNumberKey; header: string }
  | { kind: "extra"; header: string }
  | { kind: "ignored" };

function columnRole(header: string): ColumnRole {
  const compact = compactHeader(header);
  if (!compact) return { kind: "ignored" };
  const matches = (aliases: readonly string[]) =>
    aliases.some((alias) => compactHeader(alias) === compact);

  if (matches(NAME_HEADERS)) return { kind: "name" };
  if (matches(MOBILE_HEADERS)) return { kind: "mobile" };
  if (matches(SENSITIVE_HEADERS)) return { kind: "ignored" };
  for (const field of ROSTER_TEXT_FIELDS) {
    if (matches(field.headers)) return { kind: "text", key: field.key };
  }
  for (const field of ROSTER_NUMBER_FIELDS) {
    if (matches(field.headers)) {
      return { kind: "number", key: field.key, header: field.label };
    }
  }
  return { kind: "extra", header: header.normalize("NFKC").trim() };
}

function findHeaderRow(data: unknown[][]) {
  for (let index = 0; index < Math.min(HEADER_SCAN_ROWS, data.length); index += 1) {
    const roles = (data[index] ?? []).map((cell) => columnRole(cellText(cell)));
    const hasName = roles.some((role) => role.kind === "name");
    const hasMobile = roles.some((role) => role.kind === "mobile");
    if (hasName && hasMobile) return { index, roles };
  }
  return null;
}

/**
 * Picks the first sheet whose header row has both 姓名 and 手機, then turns
 * each data row into a person. Rows without a name are reported and skipped;
 * a missing or unreadable mobile is imported with a warning, because that
 * person simply cannot match until the admin fills it in.
 */
export function parseRosterSheets(sheets: RosterSheet[]): ParsedRoster {
  let chosen: { sheet: RosterSheet; header: NonNullable<ReturnType<typeof findHeaderRow>> } | null =
    null;
  for (const sheet of sheets) {
    const header = findHeaderRow(sheet.data);
    if (header) {
      chosen = { sheet, header };
      break;
    }
  }

  if (!chosen) {
    throw new RosterInputError("找不到同時有「姓名」與「手機」欄位的工作表。");
  }

  const { sheet, header } = chosen;
  const headerCells = sheet.data[header.index] ?? [];
  const roles = header.roles;
  const nameColumn = roles.findIndex((role) => role.kind === "name");
  const mobileColumn = roles.findIndex((role) => role.kind === "mobile");
  const ignoredColumns = headerCells
    .map((cell, column) => ({ text: cellText(cell), role: roles[column] }))
    .filter(({ text, role }) => text && role?.kind === "ignored")
    .map(({ text }) => text);

  const dataRows = sheet.data.slice(header.index + 1);
  if (dataRows.length > MAX_ROSTER_ROWS) {
    throw new RosterInputError(`名單超過 ${MAX_ROSTER_ROWS} 列，請分批匯入。`);
  }

  const rows: ParsedRosterRow[] = [];
  const issues: RosterIssue[] = [];

  dataRows.forEach((cells, offset) => {
    const rowNumber = header.index + 2 + offset;
    if (!cells.some((cell) => cellText(cell))) return;

    const name = cleanRosterName(cellText(cells[nameColumn]));
    if (!name) {
      issues.push({
        row: rowNumber,
        name: "",
        level: "skipped",
        message: "沒有姓名，已略過。",
      });
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      issues.push({
        row: rowNumber,
        name: name.slice(0, 20),
        level: "skipped",
        message: "姓名過長，已略過。",
      });
      return;
    }

    const mobileCell = cells[mobileColumn];
    const mobileRaw = cellText(mobileCell);
    const mobile = normalizeRosterMobile(
      typeof mobileCell === "number" ? mobileCell : mobileRaw,
    );
    if (!mobileRaw) {
      issues.push({
        row: rowNumber,
        name,
        level: "warning",
        message: "沒有手機號碼，匯入後此人無法比對。",
      });
    } else if (!mobile) {
      issues.push({
        row: rowNumber,
        name,
        level: "warning",
        message: `手機號碼「${mobileRaw}」無法辨識，匯入後此人無法比對。`,
      });
    }

    const fields = emptyRosterFields();
    const extra: Record<string, string> = {};
    roles.forEach((role, column) => {
      const value = cells[column];
      if (role.kind === "text") {
        const text = cellText(value).slice(0, MAX_TEXT_LENGTH);
        // Two aliases of one field (e.g. 背心 and 背心尺寸): keep the first filled.
        if (text && !fields[role.key]) fields[role.key] = text;
      } else if (role.kind === "number") {
        const parsed = cellNumber(value);
        if (parsed === "invalid") {
          const text = cellText(value).slice(0, MAX_TEXT_LENGTH);
          extra[role.header] = text;
          issues.push({
            row: rowNumber,
            name,
            level: "warning",
            message: `「${role.header}」不是數字，已原樣保留在其他欄位。`,
          });
        } else if (parsed !== null && fields[role.key] === null) {
          fields[role.key] = parsed;
        }
      } else if (role.kind === "extra") {
        const text = cellText(value).slice(0, MAX_TEXT_LENGTH);
        if (
          text &&
          !(role.header in extra) &&
          Object.keys(extra).length < MAX_EXTRA_KEYS
        ) {
          extra[role.header] = text;
        }
      }
    });

    rows.push({
      row: rowNumber,
      name,
      nameKey: rosterNameKey(name),
      mobile,
      mobileRaw,
      fields,
      extra,
    });
  });

  return { sheet: sheet.sheet, rows, issues, ignoredColumns };
}

// —— Import planning ——

export type RosterPatch = Partial<
  Pick<RosterEntryData, "mobile" | "matchKey" | "extra"> & RosterFields
>;

export type RosterImportPlan = {
  sheet: string;
  creates: ParsedRosterRow[];
  updates: {
    id: string;
    row: ParsedRosterRow;
    /** Field labels for the preview, e.g. ["手機", "備註"]. */
    changes: string[];
    patch: RosterPatch;
  }[];
  unchanged: number;
  issues: RosterIssue[];
  ignoredColumns: string[];
};

function mergeRows(into: ParsedRosterRow, from: ParsedRosterRow) {
  for (const field of ROSTER_TEXT_FIELDS) {
    if (!into.fields[field.key] && from.fields[field.key]) {
      into.fields[field.key] = from.fields[field.key];
    }
  }
  for (const field of ROSTER_NUMBER_FIELDS) {
    if (into.fields[field.key] === null && from.fields[field.key] !== null) {
      into.fields[field.key] = from.fields[field.key];
    }
  }
  for (const [key, value] of Object.entries(from.extra)) {
    if (!(key in into.extra)) into.extra[key] = value;
  }
}

/**
 * Sheet values win, but only where the sheet has something: a blank cell never
 * erases what an admin typed into the dashboard. Nobody is ever deleted by an
 * import — people missing from the sheet are left alone.
 */
function diffRow(row: ParsedRosterRow, entry: RosterEntry) {
  const patch: RosterPatch = {};
  const changes: string[] = [];

  if (row.mobile && row.mobile !== entry.mobile) {
    patch.mobile = row.mobile;
    patch.matchKey = rosterMatchKey(entry.name, row.mobile);
    changes.push("手機");
  }
  for (const field of ROSTER_TEXT_FIELDS) {
    const value = row.fields[field.key];
    if (value && value !== (entry[field.key] ?? "")) {
      patch[field.key] = value;
      changes.push(field.label);
    }
  }
  for (const field of ROSTER_NUMBER_FIELDS) {
    const value = row.fields[field.key];
    if (value !== null && value !== (entry[field.key] ?? null)) {
      patch[field.key] = value;
      changes.push(field.label);
    }
  }
  const extraChanges = Object.entries(row.extra).filter(
    ([key, value]) => (entry.extra ?? {})[key] !== value,
  );
  if (extraChanges.length) {
    patch.extra = { ...(entry.extra ?? {}), ...Object.fromEntries(extraChanges) };
    changes.push(...extraChanges.map(([key]) => key));
  }

  return { patch, changes };
}

export function planRosterImport(
  parsed: ParsedRoster,
  existing: RosterEntry[],
): RosterImportPlan {
  const issues = [...parsed.issues];

  // 1. Collapse repeats inside the sheet itself (same person listed twice).
  const firstByKey = new Map<string, ParsedRosterRow>();
  const rows: ParsedRosterRow[] = [];
  for (const source of parsed.rows) {
    const row = { ...source, fields: { ...source.fields }, extra: { ...source.extra } };
    const key = rosterMatchKey(row.name, row.mobile) ?? `${row.nameKey}|`;
    const first = firstByKey.get(key);
    if (first) {
      mergeRows(first, row);
      issues.push({
        row: row.row,
        name: row.name,
        level: "warning",
        message: `與第 ${first.row} 列是同一人，已合併。`,
      });
      continue;
    }
    firstByKey.set(key, row);
    rows.push(row);
  }

  // 2. Find who each row refers to in Firestore.
  const byMatchKey = new Map<string, RosterEntry>();
  const byName = new Map<string, RosterEntry[]>();
  for (const entry of existing) {
    if (entry.matchKey) byMatchKey.set(entry.matchKey, entry);
    const list = byName.get(entry.nameKey) ?? [];
    list.push(entry);
    byName.set(entry.nameKey, list);
  }

  const plan: RosterImportPlan = {
    sheet: parsed.sheet,
    creates: [],
    updates: [],
    unchanged: 0,
    issues,
    ignoredColumns: parsed.ignoredColumns,
  };
  const claimed = new Map<string, number>();

  for (const row of rows) {
    const sameName = byName.get(row.nameKey) ?? [];
    let target: RosterEntry | undefined;

    if (row.mobile) {
      target = byMatchKey.get(rosterMatchKey(row.name, row.mobile)!);
      // The sheet now has a mobile for someone imported without one.
      if (!target) {
        const withoutMobile = sameName.filter((entry) => !entry.mobile);
        if (withoutMobile.length === 1 && sameName.length === 1) {
          target = withoutMobile[0];
        }
      }
    } else if (sameName.length === 1) {
      // No mobile in the sheet: only safe to update when the name is unique.
      target = sameName[0];
    } else if (sameName.length > 1) {
      issues.push({
        row: row.row,
        name: row.name,
        level: "skipped",
        message: "名單中有多位同名者且此列沒有手機，無法判斷是哪一位，已略過。",
      });
      continue;
    }

    if (target) {
      const earlier = claimed.get(target.id);
      if (earlier !== undefined) {
        issues.push({
          row: row.row,
          name: row.name,
          level: "skipped",
          message: `與第 ${earlier} 列對應到同一筆資料，已略過。`,
        });
        continue;
      }
      claimed.set(target.id, row.row);
      const { patch, changes } = diffRow(row, target);
      if (changes.length) {
        plan.updates.push({ id: target.id, row, changes, patch });
      } else {
        plan.unchanged += 1;
      }
      continue;
    }

    plan.creates.push(row);
  }

  issues.sort((left, right) => left.row - right.row);
  return plan;
}

/** What the admin preview shows; leaves out every column but seat and mobile. */
export type RosterImportSummary = {
  mode: "preview" | "apply";
  sheet: string;
  creates: { row: number; name: string; mobile: string | null; seat: string }[];
  updates: { row: number; name: string; changes: string[] }[];
  unchanged: number;
  issues: RosterImportPlan["issues"];
  ignoredColumns: string[];
};

export function summarizeRosterImport(
  mode: RosterImportSummary["mode"],
  plan: RosterImportPlan,
): RosterImportSummary {
  return {
    mode,
    sheet: plan.sheet,
    creates: plan.creates.map((row) => ({
      row: row.row,
      name: row.name,
      mobile: row.mobile,
      seat: row.fields.seat,
    })),
    updates: plan.updates.map((update) => ({
      row: update.row.row,
      name: update.row.name,
      changes: update.changes,
    })),
    unchanged: plan.unchanged,
    issues: plan.issues,
    ignoredColumns: plan.ignoredColumns,
  };
}

export function rosterEntryFromRow(
  row: ParsedRosterRow,
  now: string,
): RosterEntryData {
  return {
    name: row.name,
    nameKey: row.nameKey,
    mobile: row.mobile,
    matchKey: rosterMatchKey(row.name, row.mobile),
    ...row.fields,
    extra: row.extra,
    source: "import",
    createdAt: now,
    updatedAt: now,
  };
}

// —— Admin edits ——

function inputText(value: unknown, label: string, max = MAX_TEXT_LENGTH) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") {
    throw new RosterInputError(`「${label}」格式不正確。`);
  }
  const text = String(value).normalize("NFKC").trim();
  if (text.length > max) {
    throw new RosterInputError(`「${label}」不可超過 ${max} 字。`);
  }
  return text;
}

/** Validates an admin create/edit body. Every editable field is replaced. */
export function parseRosterInput(body: unknown): RosterInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RosterInputError("資料格式不正確。");
  }
  const record = body as Record<string, unknown>;

  const name = cleanRosterName(inputText(record.name, "姓名", MAX_NAME_LENGTH));
  if (!name) throw new RosterInputError("請填寫姓名。");

  const mobileText = inputText(record.mobile, "手機", 40);
  const mobile = mobileText ? normalizeRosterMobile(mobileText) : null;
  if (mobileText && !mobile) {
    throw new RosterInputError("手機需為台灣手機號碼，例如 0912345678。");
  }

  const fields = emptyRosterFields();
  for (const field of ROSTER_TEXT_FIELDS) {
    fields[field.key] = inputText(record[field.key], field.label);
  }
  for (const field of ROSTER_NUMBER_FIELDS) {
    const parsed = cellNumber(record[field.key]);
    if (parsed === "invalid") {
      throw new RosterInputError(`「${field.label}」需為數字。`);
    }
    fields[field.key] = parsed;
  }

  const extra: Record<string, string> = {};
  if (record.extra !== undefined && record.extra !== null) {
    if (typeof record.extra !== "object" || Array.isArray(record.extra)) {
      throw new RosterInputError("其他欄位格式不正確。");
    }
    const pairs = Object.entries(record.extra as Record<string, unknown>);
    if (pairs.length > MAX_EXTRA_KEYS) {
      throw new RosterInputError(`其他欄位最多 ${MAX_EXTRA_KEYS} 個。`);
    }
    for (const [rawKey, rawValue] of pairs) {
      const key = inputText(rawKey, "欄位名稱", 40);
      const value = inputText(rawValue, key || "欄位");
      if (key && value) extra[key] = value;
    }
  }

  return { name, mobile, ...fields, extra };
}

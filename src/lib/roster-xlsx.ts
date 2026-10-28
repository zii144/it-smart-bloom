import { strFromU8, unzipSync } from "fflate";
import readExcelFile from "read-excel-file/universal";
import {
  MAX_ROSTER_FILE_BYTES,
  parseRosterSheets,
  RosterInputError,
  type ParsedRoster,
} from "@/lib/roster";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
/** Legacy Excel 97–2003 (.xls) files are OLE compound documents. */
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function xmlAttribute(tag: string, name: string) {
  const match = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return match ? decodeXmlText(match[1] ?? match[2] ?? "") : null;
}

export type WorkbookSheetInfo = {
  /** Sheets hidden in Excel (state "hidden" or "veryHidden"). */
  hidden: Set<string>;
  /** The sheet that was open when the file was last saved. */
  activeSheet: string | null;
};

/**
 * read-excel-file returns every sheet's cells but not whether a sheet is
 * hidden or which one was open, so read that from xl/workbook.xml directly.
 * Best effort: anything unexpected means "all visible, none active".
 */
export function readWorkbookSheetInfo(buffer: ArrayBuffer): WorkbookSheetInfo {
  const info: WorkbookSheetInfo = { hidden: new Set(), activeSheet: null };
  let xml: string;
  try {
    const files = unzipSync(new Uint8Array(buffer), {
      filter: (file) => file.name === "xl/workbook.xml",
    });
    const workbook = files["xl/workbook.xml"];
    if (!workbook) return info;
    xml = strFromU8(workbook);
  } catch {
    return info;
  }

  const names: string[] = [];
  for (const [tag] of xml.matchAll(/<(?:\w+:)?sheet\b[^>]*>/g)) {
    const name = xmlAttribute(tag, "name");
    if (name === null) continue;
    names.push(name);
    const state = xmlAttribute(tag, "state");
    if (state === "hidden" || state === "veryHidden") info.hidden.add(name);
  }

  // activeTab indexes every sheet in workbook order, hidden ones included.
  const view = /<(?:\w+:)?workbookView\b[^>]*>/.exec(xml)?.[0];
  const activeTab = Number(view ? (xmlAttribute(view, "activeTab") ?? 0) : 0);
  info.activeSheet = Number.isInteger(activeTab) ? (names[activeTab] ?? null) : null;
  return info;
}

/** Reads an uploaded `.xlsx` into roster rows. Never touches the filesystem. */
export async function parseRosterWorkbook(file: File): Promise<ParsedRoster> {
  if (file.size === 0) throw new RosterInputError("檔案是空的。");
  if (file.size > MAX_ROSTER_FILE_BYTES) {
    throw new RosterInputError("檔案需小於 5 MB。");
  }

  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (startsWith(head, OLE_SIGNATURE)) {
    throw new RosterInputError(
      "這是舊版 .xls 檔，請在 Excel 以「另存新檔 → .xlsx」後再上傳。",
    );
  }
  if (!startsWith(head, ZIP_SIGNATURE)) {
    throw new RosterInputError("請上傳 Excel .xlsx 檔案。");
  }

  // Before readExcelFile, which may take ownership of the buffer.
  const info = readWorkbookSheetInfo(buffer);
  let sheets: Awaited<ReturnType<typeof readExcelFile>>;
  try {
    sheets = await readExcelFile(buffer);
  } catch (error) {
    console.error("Failed to read roster workbook:", error);
    throw new RosterInputError("無法讀取這個 Excel 檔，請確認檔案沒有損壞。");
  }

  return parseRosterSheets(
    sheets.map((sheet) => ({
      sheet: sheet.sheet,
      data: sheet.data,
      hidden: info.hidden.has(sheet.sheet),
    })),
    { activeSheet: info.activeSheet },
  );
}

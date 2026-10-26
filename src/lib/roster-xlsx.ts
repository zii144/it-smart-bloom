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

  let sheets: Awaited<ReturnType<typeof readExcelFile>>;
  try {
    sheets = await readExcelFile(buffer);
  } catch (error) {
    console.error("Failed to read roster workbook:", error);
    throw new RosterInputError("無法讀取這個 Excel 檔，請確認檔案沒有損壞。");
  }

  return parseRosterSheets(
    sheets.map((sheet) => ({ sheet: sheet.sheet, data: sheet.data })),
  );
}

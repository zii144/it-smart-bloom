import { strToU8, zipSync } from "fflate";

/** Real roster headers, so fixtures exercise the production column mapping. */
export const ROSTER_HEADER = [
  "標籤",
  "座位",
  "姓名",
  "身分",
  "手機",
  "電子郵件",
  "地址",
  "公文",
  "備註",
  "背心",
  "飯友",
  "紙袋",
  "證書",
  "導師補助",
  "團隊貴賓",
  "身分證正面",
  "身分證反面",
  "存摺",
];

type Cell = string | number | null;

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number) {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows: Cell[][]) {
  const body = rows
    .map((cells, rowIndex) => {
      const r = rowIndex + 1;
      const xmlCells = cells
        .map((cell, colIndex) => {
          if (cell === null || cell === "") return "";
          const ref = `${columnName(colIndex)}${r}`;
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r}">${xmlCells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Builds a minimal but valid .xlsx with one or more sheets. `hidden` and
 * `activeTab` mirror how Excel records hidden sheets and the open tab.
 */
export function buildXlsx(
  sheets: { name: string; rows: Cell[][]; hidden?: boolean }[],
  { activeTab }: { activeTab?: number } = {},
) {
  const workbookView =
    activeTab === undefined
      ? ""
      : `<bookViews><workbookView activeTab="${activeTab}"/></bookViews>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join("")}</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${workbookView}<sheets>${sheets
        .map(
          (sheet, index) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}"${
              sheet.hidden ? ' state="hidden"' : ""
            } r:id="rId${index + 1}"/>`,
        )
        .join("")}</sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet.rows));
  });
  return zipSync(files);
}

export function xlsxFile(bytes: Uint8Array, name = "roster.xlsx") {
  return new File([new Uint8Array(bytes)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** A row in the real sheet's column order; unspecified columns stay blank. */
export function rosterRow(values: Partial<Record<string, Cell>>): Cell[] {
  return ROSTER_HEADER.map((header) => values[header] ?? null);
}

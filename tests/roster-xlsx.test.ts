import { describe, expect, it } from "vitest";
import { RosterInputError } from "@/lib/roster";
import { parseRosterWorkbook, readWorkbookSheetInfo } from "@/lib/roster-xlsx";
import { buildXlsx, ROSTER_HEADER, rosterRow, xlsxFile } from "./xlsx-fixture";

/** Shaped like the QA file: an old hidden copy first, the live list after it. */
function workbookWithOldHiddenCopy(activeTab?: number) {
  return buildXlsx(
    [
      {
        name: "XX成果展名單合併版",
        hidden: true,
        rows: [
          ROSTER_HEADER,
          rosterRow({ 座位: "E1", 姓名: "林盈秀", 手機: "0937452659" }),
          rosterRow({ 座位: "L3", 姓名: "陳志信", 手機: null }),
          rosterRow({ 座位: "C1", 姓名: "林滿家屬", 手機: null }),
        ],
      },
      {
        name: "工作表1",
        rows: [
          ROSTER_HEADER,
          rosterRow({ 座位: "D5", 姓名: "林盈秀", 手機: "0937452659" }),
          rosterRow({ 座位: "L3", 姓名: "陳志信", 手機: "0932321487" }),
        ],
      },
      { name: "xx晶宴座位安排", hidden: true, rows: [["舞台區"]] },
    ],
    { activeTab },
  );
}

describe("parseRosterWorkbook: which sheet", () => {
  it("imports the visible list, not an old hidden copy before it (QA 10/28)", async () => {
    const parsed = await parseRosterWorkbook(xlsxFile(workbookWithOldHiddenCopy(1)));

    expect(parsed.sheet).toBe("工作表1");
    // Seats, mobiles and the set of people all come from the live sheet.
    expect(parsed.rows.map((row) => [row.fields.seat, row.name, row.mobile])).toEqual([
      ["D5", "林盈秀", "0937452659"],
      ["L3", "陳志信", "0932321487"],
    ]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.otherSheets).toEqual([{ name: "XX成果展名單合併版", hidden: true }]);
  });

  it("skips hidden sheets even when the file does not say which tab was open", async () => {
    const parsed = await parseRosterWorkbook(xlsxFile(workbookWithOldHiddenCopy()));
    expect(parsed.sheet).toBe("工作表1");
  });

  it("prefers the tab that was open among several visible lists", async () => {
    const bytes = buildXlsx(
      [
        { name: "舊版", rows: [ROSTER_HEADER, rosterRow({ 姓名: "甲", 手機: "0911111111" })] },
        { name: "新版", rows: [ROSTER_HEADER, rosterRow({ 姓名: "乙", 手機: "0922222222" })] },
      ],
      { activeTab: 1 },
    );

    const parsed = await parseRosterWorkbook(xlsxFile(bytes));

    expect(parsed.sheet).toBe("新版");
    expect(parsed.otherSheets).toEqual([{ name: "舊版", hidden: false }]);
  });

  it("falls back to a hidden sheet when it is the only list", async () => {
    const bytes = buildXlsx([
      { name: "封面", rows: [["成果展"]] },
      {
        name: "名單",
        hidden: true,
        rows: [ROSTER_HEADER, rosterRow({ 姓名: "甲", 手機: "0911111111" })],
      },
    ]);

    const parsed = await parseRosterWorkbook(xlsxFile(bytes));

    expect(parsed.sheet).toBe("名單");
    expect(parsed.rows).toHaveLength(1);
  });
});

describe("readWorkbookSheetInfo", () => {
  it("reads hidden sheets and the open tab, decoding XML in names", () => {
    const bytes = buildXlsx(
      [
        { name: "114-115導師&邀請團體", hidden: true, rows: [["a"]] },
        { name: "工作表1", rows: [["b"]] },
      ],
      { activeTab: 1 },
    );

    const info = readWorkbookSheetInfo(bytes.buffer as ArrayBuffer);

    expect([...info.hidden]).toEqual(["114-115導師&邀請團體"]);
    expect(info.activeSheet).toBe("工作表1");
  });

  it("treats the first sheet as open when Excel did not record a tab", () => {
    const info = readWorkbookSheetInfo(
      buildXlsx([{ name: "名單", rows: [["a"]] }]).buffer as ArrayBuffer,
    );
    expect(info.activeSheet).toBe("名單");
  });

  it("never throws on something that is not a workbook", () => {
    const info = readWorkbookSheetInfo(new Uint8Array([1, 2, 3]).buffer);
    expect(info).toEqual({ hidden: new Set(), activeSheet: null });
  });
});

describe("parseRosterWorkbook", () => {
  it("reads a real .xlsx, including a mobile stored as a number cell", async () => {
    const bytes = buildXlsx([
      { name: "其他", rows: [["座位", "姓名"], ["Z9", "不該被讀到"]] },
      {
        name: "成果展名單合併版",
        rows: [
          ROSTER_HEADER,
          rosterRow({ 座位: "A1", 姓名: "甲", 手機: "0911111111", 導師補助: 500 }),
          rosterRow({ 座位: "A2", 姓名: "乙", 手機: 922222222 }),
        ],
      },
    ]);

    const parsed = await parseRosterWorkbook(xlsxFile(bytes));

    expect(parsed.sheet).toBe("成果展名單合併版");
    expect(parsed.rows.map((row) => [row.fields.seat, row.name, row.mobile])).toEqual([
      ["A1", "甲", "0911111111"],
      ["A2", "乙", "0922222222"],
    ]);
    expect(parsed.rows[0]?.fields.mentorSubsidy).toBe(500);
  });

  it("asks for .xlsx when given a legacy .xls file", async () => {
    const legacy = new File(
      [new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
      "roster.xls",
    );
    await expect(parseRosterWorkbook(legacy)).rejects.toThrow(/另存新檔/);
  });

  it("rejects files that are not spreadsheets", async () => {
    const csv = new File(["姓名,手機\n甲,0911111111"], "roster.xlsx");
    await expect(parseRosterWorkbook(csv)).rejects.toThrow(RosterInputError);
  });

  it("rejects a corrupt zip with a friendly message", async () => {
    const broken = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6])],
      "roster.xlsx",
    );
    await expect(parseRosterWorkbook(broken)).rejects.toThrow(/無法讀取/);
  });

  it("rejects empty and oversized files before reading them", async () => {
    await expect(parseRosterWorkbook(new File([], "a.xlsx"))).rejects.toThrow(/空/);
    const huge = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "a.xlsx");
    await expect(parseRosterWorkbook(huge)).rejects.toThrow(/5 MB/);
  });
});

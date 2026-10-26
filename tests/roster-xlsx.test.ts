import { describe, expect, it } from "vitest";
import { RosterInputError } from "@/lib/roster";
import { parseRosterWorkbook } from "@/lib/roster-xlsx";
import { buildXlsx, ROSTER_HEADER, rosterRow, xlsxFile } from "./xlsx-fixture";

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

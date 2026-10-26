import { describe, expect, it } from "vitest";
import { buildCheckInCsv, csvCell, portraitLabel } from "@/lib/check-in-csv";
import type { RosterEntry } from "@/lib/roster";

function entry(overrides: Partial<RosterEntry>): RosterEntry {
  return {
    id: "a",
    name: "王小美",
    nameKey: "王小美",
    mobile: "0911111111",
    matchKey: "王小美|0911111111",
    seat: "A1",
    tag: "",
    role: "114年13",
    email: "",
    address: "",
    officialDoc: "",
    note: "",
    vest: "",
    mealGroup: "",
    mentorSubsidy: null,
    teamGuest: null,
    extra: {},
    source: "import",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("csvCell", () => {
  it("quotes and escapes quotes", () => {
    expect(csvCell('他說"好"')).toBe('"他說""好"""');
    expect(csvCell(null)).toBe('""');
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx"])(
    "defuses spreadsheet formulas in %j",
    (value) => {
      expect(csvCell(value).startsWith(`"'`)).toBe(true);
    },
  );

  it("leaves phone numbers alone", () => {
    expect(csvCell("0911111111")).toBe('"0911111111"');
  });
});

describe("buildCheckInCsv", () => {
  it("lists arrival in Taiwan time, who checked them in, and the portrait", () => {
    const csv = buildCheckInCsv([
      entry({
        checkedInAt: "2026-11-10T06:02:30.000Z",
        checkInSource: "self",
        portraitStatus: "complete",
      }),
      entry({ id: "b", name: "林大同", seat: "A2", mobile: null, checkInSource: null }),
      entry({
        id: "c",
        name: "陳志明",
        seat: "A3",
        checkedInAt: "2026-11-10T06:10:00.000Z",
        checkInSource: "admin",
        portraitStatus: "generating",
      }),
    ]);

    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe(
      '"座位","姓名","手機","身分","報到狀態","報到時間","報到方式","似顏繪"',
    );
    expect(lines[1]).toBe(
      '"A1","王小美","0911111111","114年13","已報到","2026/11/10 14:02:30","自助","已完成"',
    );
    expect(lines[2]).toBe('"A2","林大同","","114年13","未報到","","","尚未創作"');
    expect(lines[3]).toContain('"工作人員","創作中"');
  });
});

describe("portraitLabel", () => {
  it("treats a missing status as not started", () => {
    expect(portraitLabel({ portraitStatus: undefined })).toBe("尚未創作");
    expect(portraitLabel({ portraitStatus: "failed" })).toBe("創作失敗");
  });
});

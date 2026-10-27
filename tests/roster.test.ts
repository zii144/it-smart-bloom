import { describe, expect, it } from "vitest";
import {
  hasSubmittedPhoto,
  normalizeRosterMobile,
  parseRosterInput,
  parseRosterSheets,
  planRosterImport,
  rosterMatchKey,
  rosterNameKey,
  RosterInputError,
  summarizeRosterImport,
  type ParsedRoster,
  type RosterEntry,
} from "@/lib/roster";
import { ROSTER_HEADER, rosterRow } from "./xlsx-fixture";

function sheet(rows: unknown[][], name = "名單") {
  return parseRosterSheets([{ sheet: name, data: rows }]);
}

function entry(overrides: Partial<RosterEntry> & { name: string }): RosterEntry {
  const mobile = overrides.mobile ?? null;
  return {
    id: overrides.id ?? `id-${overrides.name}`,
    mobile,
    nameKey: rosterNameKey(overrides.name),
    matchKey: rosterMatchKey(overrides.name, mobile),
    seat: "",
    tag: "",
    role: "",
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

describe("normalizeRosterMobile", () => {
  it.each([
    ["0912345678", "0912345678"],
    ["0912-345-678", "0912345678"],
    [" 0912 345 678 ", "0912345678"],
    ["(0912)345678", "0912345678"],
    ["+886 912 345 678", "0912345678"],
    ["886912345678", "0912345678"],
    ["０９１２３４５６７８", "0912345678"],
    [912345678, "0912345678"],
    ["912345678", "0912345678"],
  ])("accepts %j", (raw, expected) => {
    expect(normalizeRosterMobile(raw)).toBe(expected);
  });

  it.each([["0212345678"], ["091234567"], ["09123456789"], ["abc"], [""], [null], [9.12e8 + 0.5]])(
    "rejects %j",
    (raw) => {
      expect(normalizeRosterMobile(raw)).toBeNull();
    },
  );
});

describe("rosterMatchKey", () => {
  it("ignores whitespace and full-width forms in the name", () => {
    expect(rosterMatchKey(" 張 小明", "0912345678")).toBe(
      rosterMatchKey("張小明", "0912345678"),
    );
  });

  it("is null without a mobile, so that person can never match", () => {
    expect(rosterMatchKey("張小明", null)).toBeNull();
  });
});

describe("parseRosterSheets", () => {
  it("maps the real sheet's columns and skips the identity-document ones", () => {
    const parsed = sheet([
      ROSTER_HEADER,
      rosterRow({
        標籤: "V",
        座位: "A2",
        姓名: "王小美",
        身分: "114年13",
        手機: "0911-111-111",
        電子郵件: "mei@example.com",
        地址: "某市某路 1 號",
        備註: "導師確認出席",
        背心: "XL",
        飯友: "女",
        導師補助: 1000,
        團隊貴賓: 0,
        身分證正面: "should-not-import",
        存摺: "should-not-import",
      }),
    ]);

    expect(parsed.ignoredColumns).toEqual(["身分證正面", "身分證反面", "存摺"]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    const [row] = parsed.rows;
    expect(row).toMatchObject({
      row: 2,
      name: "王小美",
      mobile: "0911111111",
      mobileRaw: "0911-111-111",
      fields: {
        tag: "V",
        seat: "A2",
        role: "114年13",
        email: "mei@example.com",
        note: "導師確認出席",
        vest: "XL",
        mealGroup: "女",
        mentorSubsidy: 1000,
        teamGuest: 0,
      },
      extra: {},
    });
    expect(JSON.stringify(row)).not.toContain("should-not-import");
  });

  it("uses the first sheet that has both 姓名 and 手機", () => {
    const parsed = parseRosterSheets([
      { sheet: "沒有手機", data: [["座位", "姓名"], ["A1", "甲"]] },
      { sheet: "主名單", data: [["姓名", "手機"], ["乙", "0922222222"]] },
    ]);
    expect(parsed.sheet).toBe("主名單");
    expect(parsed.rows.map((row) => row.name)).toEqual(["乙"]);
  });

  it("finds a header row below a title row", () => {
    const parsed = sheet([
      ["1151110 成果展名單"],
      [],
      ["姓名", "手機"],
      ["丙", "0933333333"],
    ]);
    expect(parsed.rows[0]).toMatchObject({ row: 4, name: "丙" });
  });

  it("refuses a workbook without the two required columns", () => {
    expect(() => sheet([["座位", "姓名"], ["A1", "甲"]])).toThrow(RosterInputError);
  });

  it("skips nameless rows and blank rows, and warns about mobiles", () => {
    const parsed = sheet([
      ["姓名", "手機", "備註"],
      [null, "0911111111", "孤兒列"],
      [null, null, null],
      ["丁", null, null],
      ["戊", "02-1234-5678", null],
    ]);

    expect(parsed.rows.map((row) => [row.name, row.mobile])).toEqual([
      ["丁", null],
      ["戊", null],
    ]);
    expect(parsed.issues).toEqual([
      expect.objectContaining({ row: 2, level: "skipped" }),
      expect.objectContaining({ row: 4, name: "丁", level: "warning" }),
      expect.objectContaining({
        row: 5,
        name: "戊",
        level: "warning",
        message: expect.stringContaining("02-1234-5678"),
      }),
    ]);
  });

  it("keeps unknown columns as extra and non-numeric amounts as text", () => {
    const parsed = sheet([
      ["姓名", "手機", "導師補助", "葷素"],
      ["己", "0944444444", "待確認", "素"],
    ]);
    expect(parsed.rows[0]?.fields.mentorSubsidy).toBeNull();
    expect(parsed.rows[0]?.extra).toEqual({ 導師補助: "待確認", 葷素: "素" });
    expect(parsed.issues).toEqual([
      expect.objectContaining({ level: "warning", message: expect.stringContaining("導師補助") }),
    ]);
  });
});

describe("planRosterImport", () => {
  const header = ["姓名", "手機", "座位", "備註"];

  function plan(rows: unknown[][], existing: RosterEntry[] = []) {
    return planRosterImport(sheet([header, ...rows]), existing);
  }

  it("creates everyone on a first import", () => {
    const result = plan([
      ["甲", "0911111111", "A1", null],
      ["乙", null, "A2", null],
    ]);
    expect(result.creates.map((row) => row.name)).toEqual(["甲", "乙"]);
    expect(result.updates).toEqual([]);
    expect(result.unchanged).toBe(0);
  });

  it("merges the same person listed twice in the sheet", () => {
    const result = plan([
      ["甲", "0911111111", "A1", null],
      ["甲", "0911-111-111", null, "第二列的備註"],
    ]);
    expect(result.creates).toHaveLength(1);
    expect(result.creates[0]?.fields).toMatchObject({ seat: "A1", note: "第二列的備註" });
    expect(result.issues).toEqual([
      expect.objectContaining({ row: 3, message: expect.stringContaining("第 2 列") }),
    ]);
  });

  it("updates only what the sheet fills in and never clears admin edits", () => {
    const existing = [
      entry({ name: "甲", mobile: "0911111111", seat: "A1", note: "管理員備註" }),
    ];
    const result = plan([["甲", "0911111111", "B7", null]], existing);
    expect(result.updates).toEqual([
      expect.objectContaining({
        id: "id-甲",
        changes: ["座位"],
        patch: { seat: "B7" },
      }),
    ]);
  });

  it("counts rows with nothing new as unchanged", () => {
    const existing = [entry({ name: "甲", mobile: "0911111111", seat: "A1" })];
    const result = plan([["甲", "0911111111", "A1", null]], existing);
    expect(result.unchanged).toBe(1);
    expect(result.updates).toEqual([]);
    expect(result.creates).toEqual([]);
  });

  it("fills in a mobile for someone first imported without one", () => {
    const existing = [entry({ name: "乙", mobile: null })];
    const result = plan([["乙", "0922222222", null, null]], existing);
    expect(result.updates).toEqual([
      expect.objectContaining({
        id: "id-乙",
        changes: ["手機"],
        patch: { mobile: "0922222222", matchKey: "乙|0922222222" },
      }),
    ]);
  });

  it("does not undo a mobile an admin added when the sheet still lacks it", () => {
    const existing = [entry({ name: "乙", mobile: "0922222222", seat: "A2" })];
    const result = plan([["乙", null, "A2", null]], existing);
    expect(result.unchanged).toBe(1);
    expect(result.creates).toEqual([]);
  });

  it("skips a mobile-less row when several people share the name", () => {
    const existing = [
      entry({ id: "one", name: "丙", mobile: "0933333333" }),
      entry({ id: "two", name: "丙", mobile: "0944444444" }),
    ];
    const result = plan([["丙", null, "C1", null]], existing);
    expect(result.creates).toEqual([]);
    expect(result.updates).toEqual([]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "skipped", message: expect.stringContaining("同名") }),
    );
  });

  it("treats same name with a different mobile as a different person", () => {
    const existing = [entry({ name: "丁", mobile: "0911111111" })];
    const result = plan([["丁", "0955555555", null, null]], existing);
    expect(result.creates.map((row) => row.mobile)).toEqual(["0955555555"]);
    expect(result.updates).toEqual([]);
  });

  it("never plans a deletion for people missing from the sheet", () => {
    const existing = [entry({ name: "戊", mobile: "0966666666" })];
    const result = plan([["己", "0977777777", null, null]], existing);
    expect(result.creates).toHaveLength(1);
    expect(result.updates).toEqual([]);
    expect(Object.keys(result)).not.toContain("deletes");
  });

  it("summarizes for the preview without leaking other columns", () => {
    const parsed: ParsedRoster = sheet([
      ["姓名", "手機", "座位", "地址"],
      ["甲", "0911111111", "A1", "某市某路 1 號"],
    ]);
    const summary = summarizeRosterImport("preview", planRosterImport(parsed, []));
    expect(summary.creates).toEqual([
      { row: 2, name: "甲", mobile: "0911111111", seat: "A1" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("某市某路");
  });
});

describe("hasSubmittedPhoto", () => {
  it("is set by an accepted photo and cleared when an admin allows another", () => {
    expect(hasSubmittedPhoto({ photoSubmittedAt: "2026-11-10T06:00:00.000Z" })).toBe(true);
    expect(hasSubmittedPhoto({ photoSubmittedAt: null, portraitSessionId: "old" })).toBe(false);
  });

  it("counts a portrait from before the rule existed, unless it failed", () => {
    expect(hasSubmittedPhoto({ portraitSessionId: "legacy" })).toBe(true);
    expect(hasSubmittedPhoto({ portraitSessionId: "legacy", portraitStatus: "complete" })).toBe(true);
    expect(hasSubmittedPhoto({ portraitSessionId: "legacy", portraitStatus: "failed" })).toBe(false);
    expect(hasSubmittedPhoto({})).toBe(false);
  });
});

describe("parseRosterInput", () => {
  it("normalizes a valid admin edit", () => {
    expect(
      parseRosterInput({
        name: "  張 小明 ",
        mobile: "0912-345-678",
        seat: "A1",
        mentorSubsidy: "1,000",
        teamGuest: "",
        extra: { 葷素: "素", 空白: "" },
      }),
    ).toMatchObject({
      name: "張 小明",
      mobile: "0912345678",
      seat: "A1",
      mentorSubsidy: 1000,
      teamGuest: null,
      extra: { 葷素: "素" },
    });
  });

  it("allows clearing the mobile", () => {
    expect(parseRosterInput({ name: "甲", mobile: "" }).mobile).toBeNull();
  });

  it.each([
    [{}, /姓名/],
    [{ name: "甲", mobile: "12345" }, /手機/],
    [{ name: "甲", mentorSubsidy: "很多" }, /導師補助/],
    [{ name: "甲", note: "x".repeat(501) }, /500/],
    [{ name: "甲", extra: ["not", "an", "object"] }, /其他欄位/],
    [null, /格式/],
  ])("rejects %j", (body, message) => {
    expect(() => parseRosterInput(body)).toThrow(message);
  });
});

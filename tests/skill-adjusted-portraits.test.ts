import { describe, expect, it } from "vitest";
import {
  originalFilename as panelFilename,
  planAdjustedUploads as panelPlan,
  type PortraitGuest,
} from "@/lib/adjusted-batch";

/**
 * The agent skill's scripts carry their own copy of the admin panel's naming
 * and matching (plain Node, no build step). If the two ever disagree, an agent
 * would put a portrait on a different guest than the panel would, so they are
 * compared on the same inputs here.
 */
const LIB = "../.claude/skills/bloom-adjusted-portraits/scripts/lib.mjs";

type SkillLib = {
  originalFilename: typeof panelFilename;
  planAdjustedUploads: (
    files: { name: string; type: string; size: number }[],
    guests: PortraitGuest[],
  ) => ReturnType<typeof panelPlan>;
  mimeForName: (name: string) => string;
};

const skill = (await import(/* @vite-ignore */ LIB)) as SkillLib;

function guest(id: string, seat: string, name: string, extra: Partial<PortraitGuest> = {}) {
  return {
    id,
    seat,
    name,
    portraitStatus: "complete",
    portraitSessionId: `sess-${id}`,
    portraitAdjustedAt: null,
    ...extra,
  } as PortraitGuest;
}

const guests = [
  guest("YHvDHMZvAbCdEfGh1234", "L5", "王小明"),
  guest("zplL1TxNAbCdEfGh5678", "E5", "林 美麗", { portraitAdjustedAt: "2026-11-02T05:00:00Z" }),
  guest("b12GuestAbCdEfGh0001", "B-12", "陳大文"),
  guest("bGuestAbCdEfGh000002", "B", "張三"),
  guest("twinSeatAbCdEfGh0003", "Q1", "同座甲"),
  guest("twinSeatAbCdEfGh0004", "Q1", "同座乙"),
  guest("namesakeAbCdEfGh0005", "Q2", "王小明"),
  guest("noPortraitAbCdEfGh06", "Z9", "沒作品", { portraitStatus: null, portraitSessionId: null }),
  guest("noSeatGuestAbCdEf007", "", "無座位人"),
  guest("failedGuestAbCdEf008", "F9", "生成失敗", { portraitStatus: "failed" }),
];

const names = [
  "L5_王小明_YHvDHMZvAbCdEfGh1234.png",
  "E5_林美麗_zplL1TxNAbCdEfGh5678 (edited).jpg",
  "L5.jpg",
  "l5_final.png",
  "Ｌ５ 修.webp",
  "B-12.jpg",
  "B-12 修.png",
  "b.png",
  "Q1.png",
  "王小明.png",
  "陳大文.jpg",
  "Z9.png",
  "無座位_無座位人_noSeatGuestAbCdEf007.jpg",
  "random.png",
  "E5.heic",
  "B.psd",
  "E5.png",
  "F9_生成失敗_failedGuestAbCdEf008.jpg",
];

describe("agent skill matches the admin panel", () => {
  it("names downloads identically", () => {
    for (const entry of guests) {
      expect(skill.originalFilename(entry, "jpg")).toBe(panelFilename(entry, "jpg"));
    }
  });

  it("matches every file to the same guest, for the same reason", () => {
    const files = names.map((name) => ({ name, type: skill.mimeForName(name), size: 2048 }));
    const fromSkill = skill.planAdjustedUploads(files, guests);
    const fromPanel = panelPlan(files, guests);
    const simplify = (rows: ReturnType<typeof panelPlan>) =>
      rows.map((row) => ({
        file: row.fileName,
        guest: row.guest?.id ?? null,
        matchedBy: row.matchedBy,
        problem: row.problem,
        replaces: row.replaces,
        completesFailed: row.completesFailed,
      }));
    expect(simplify(fromSkill)).toEqual(simplify(fromPanel));
    // Sanity: the fixture really exercises id, seat, name, refusals and duplicates.
    const reasons = new Set(fromPanel.map((row) => row.matchedBy ?? row.problem?.slice(0, 6)));
    expect(reasons.size).toBeGreaterThanOrEqual(6);
  });

  it("agrees on size limits", () => {
    const files = [
      { name: "L5.png", type: "image/png", size: 40 * 1024 * 1024 },
      { name: "E5.png", type: "image/png", size: 40 * 1024 * 1024 + 1 },
      { name: "B-12.png", type: "image/png", size: 0 },
    ];
    expect(skill.planAdjustedUploads(files, guests).map((row) => row.problem)).toEqual(
      panelPlan(files, guests).map((row) => row.problem),
    );
  });

  it("reads types from extensions the way the browser does", () => {
    expect(skill.mimeForName("a.JPG")).toBe("image/jpeg");
    expect(skill.mimeForName("a.jpeg")).toBe("image/jpeg");
    expect(skill.mimeForName("a.png")).toBe("image/png");
    expect(skill.mimeForName("a.webp")).toBe("image/webp");
    expect(skill.mimeForName("a.heic")).toBe("image/heic");
    expect(skill.mimeForName("a.txt")).toBe("");
  });
});

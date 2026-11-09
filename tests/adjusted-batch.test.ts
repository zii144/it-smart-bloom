import { describe, expect, it } from "vitest";
import {
  extensionForType,
  originalFilename,
  planAdjustedUploads,
  type PortraitGuest,
} from "@/lib/adjusted-batch";

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

const wang = guest("YHvDHMZvAbCdEfGh1234", "L5", "王小明");
const lin = guest("zplL1TxNAbCdEfGh5678", "E5", "林 美麗");
const noPortrait = guest("noPortraitAbCdEfGh00", "Z9", "沒作品", {
  portraitStatus: null,
  portraitSessionId: null,
});
const noSeat = guest("noSeatGuestAbCdEf999", "", "無座位人");
const guests = [wang, lin, noPortrait, noSeat];

const png = (name: string, size = 1000) => ({ name, type: "image/png", size });

describe("originalFilename", () => {
  it("names a file by seat, name and the guest id, safe for any OS", () => {
    expect(originalFilename(wang, "jpg")).toBe("L5_王小明_YHvDHMZvAbCdEfGh1234.jpg");
    expect(originalFilename(lin, "png")).toBe("E5_林美麗_zplL1TxNAbCdEfGh5678.png");
    expect(originalFilename(noSeat, "jpg")).toBe("無座位_無座位人_noSeatGuestAbCdEf999.jpg");
    expect(originalFilename(guest("x1234567", "A/1", 'a:b*"c'), "jpg")).toBe("A1_abc_x1234567.jpg");
  });

  it("picks the extension from the response type", () => {
    expect(extensionForType("image/png")).toBe("png");
    expect(extensionForType("image/webp")).toBe("webp");
    expect(extensionForType("image/jpeg")).toBe("jpg");
    expect(extensionForType(null)).toBe("jpg");
  });
});

describe("planAdjustedUploads", () => {
  it("matches a downloaded name by guest id, even after re-export to PNG", () => {
    const [row] = planAdjustedUploads([png("L5_王小明_YHvDHMZvAbCdEfGh1234 (edited).png")], guests);
    expect(row).toMatchObject({ guest: wang, matchedBy: "id", problem: null, replaces: false });
  });

  it("trusts the guest id over a seat that disagrees", () => {
    const [row] = planAdjustedUploads([png("E5_王小明_YHvDHMZvAbCdEfGh1234.png")], guests);
    expect(row.guest).toBe(wang);
  });

  it("falls back to the seat at the start of a hand-made name", () => {
    for (const name of ["L5.jpg", "l5_final.png", "L5-v2.webp", "Ｌ５ 修.png"]) {
      const [row] = planAdjustedUploads([png(name)], guests);
      expect(row).toMatchObject({ guest: wang, matchedBy: "seat", problem: null });
    }
  });

  it("matches hyphenated or spaced seats as a whole", () => {
    const b12 = guest("b12GuestAbCdEfGh0001", "B-12", "陳大文");
    const b = guest("bGuestAbCdEfGh000002", "B", "不該配到");
    for (const name of ["B-12.jpg", "b-12_final.png", "B-12 修.webp"]) {
      const [row] = planAdjustedUploads([png(name)], [b12, b]);
      expect(row).toMatchObject({ guest: b12, matchedBy: "seat", problem: null });
    }
  });

  it("matches a file named after a guest only when the name is unique", () => {
    const [row] = planAdjustedUploads([png("王小明.png")], guests);
    expect(row).toMatchObject({ guest: wang, matchedBy: "name", problem: null });
    expect(planAdjustedUploads([png("林 美麗_修好.png")], guests)[0]).toMatchObject({
      guest: lin,
      matchedBy: "name",
    });

    const namesake = guest("namesakeAbCdEfGh0003", "Q1", "王小明");
    const [twin] = planAdjustedUploads([png("王小明.png")], [wang, namesake]);
    expect(twin.guest).toBeNull();
    expect(twin.problem).toContain("同名");
  });

  it("prefers the seat over a name", () => {
    const seatLike = guest("seatLikeAbCdEfGh0004", "Q2", "L5");
    const [row] = planAdjustedUploads([png("L5.png")], [wang, seatLike]);
    expect(row).toMatchObject({ guest: wang, matchedBy: "seat" });
  });

  it("refuses files it cannot place, or guests without a portrait", () => {
    const rows = planAdjustedUploads([png("portrait.png"), png("Z9.png")], guests);
    expect(rows[0].problem).toContain("對不到來賓");
    expect(rows[1]).toMatchObject({ guest: noPortrait });
    expect(rows[1].problem).toContain("還沒有作品可調整");
  });

  it("refuses HEIC, PSD, empty and oversized files", () => {
    const rows = planAdjustedUploads(
      [
        { name: "L5.heic", type: "image/heic", size: 1000 },
        { name: "E5.psd", type: "", size: 1000 },
        png(`L5_x_${wang.id}.png`, 0),
      ],
      [wang, lin],
    );
    expect(rows[0].problem).toContain("HEIC");
    expect(rows[1].problem).toContain("格式不支援");
    expect(rows[2].problem).toContain("40 MB");
    expect(planAdjustedUploads([png("E5.png", 41 * 1024 * 1024)], guests)[0].problem).toContain("40 MB");
  });

  it("does not let a refused file block a good one for the same guest", () => {
    const rows = planAdjustedUploads(
      [{ name: "L5.heic", type: "image/heic", size: 1000 }, png("L5.png")],
      guests,
    );
    expect(rows[0].problem).toContain("HEIC");
    expect(rows[1]).toMatchObject({ guest: wang, problem: null });
  });

  it("blocks every file aimed at the same guest", () => {
    const rows = planAdjustedUploads([png("L5.png"), png(`L5_王小明_${wang.id}.jpg`)], guests);
    expect(rows.every((row) => row.problem?.includes("同一位來賓"))).toBe(true);
  });

  it("refuses a seat shared by two guests instead of guessing", () => {
    const twin = guest("twinGuestAbCdEfGh777", "L5", "雙胞胎");
    const [row] = planAdjustedUploads([png("L5.png")], [wang, twin]);
    expect(row.guest).toBeNull();
    expect(row.problem).toContain("多位來賓");
  });

  it("lets an upload complete a failed render instead of regenerating", () => {
    const failed = guest("failedGuestAbCdEf321", "F9", "張峻瑜", { portraitStatus: "failed" });
    const [row] = planAdjustedUploads([png(`F9_張峻瑜_${failed.id}.jpg`)], [...guests, failed]);
    expect(row).toMatchObject({ guest: failed, matchedBy: "id", problem: null, completesFailed: true });
  });

  it("flags files that would replace an existing adjustment", () => {
    const adjusted = guest(wang.id, "L5", "王小明", { portraitAdjustedAt: "2026-11-01T05:00:00Z" });
    const [row] = planAdjustedUploads([png("L5.png")], [adjusted]);
    expect(row).toMatchObject({ problem: null, replaces: true });
  });
});

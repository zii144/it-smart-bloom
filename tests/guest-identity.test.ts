import { describe, expect, it } from "vitest";
import {
  IdentityError,
  identityStorageKey,
  isValidGuestName,
  normalizeGuestName,
  parseGuestIdentity,
} from "@/lib/guest-identity";

describe("parseGuestIdentity", () => {
  it("accepts a Taiwan mobile number", () => {
    expect(parseGuestIdentity({ mobile: "0912-345-678" })).toEqual({
      kind: "mobile",
      value: "0912345678",
    });
  });

  it("no longer accepts a LINE ID", () => {
    expect(() =>
      parseGuestIdentity({ lineId: "112-張小明-南投縣" } as never),
    ).toThrow(IdentityError);
  });

  it("rejects an empty submission", () => {
    expect(() => parseGuestIdentity({})).toThrow(/請填寫/);
  });

  it("rejects a non-Taiwan mobile", () => {
    expect(() => parseGuestIdentity({ mobile: "+886912345678" })).toThrow(
      /台灣手機/,
    );
  });

  it("builds a stable storage key", () => {
    expect(identityStorageKey({ kind: "mobile", value: "0912345678" })).toBe(
      "mobile_0912345678",
    );
  });
});

describe("guest name", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeGuestName("  張  小明 ")).toBe("張 小明");
  });

  it("requires 1 to 30 characters", () => {
    expect(isValidGuestName("")).toBe(false);
    expect(isValidGuestName("張小明")).toBe(true);
    expect(isValidGuestName("張".repeat(30))).toBe(true);
    expect(isValidGuestName("張".repeat(31))).toBe(false);
  });
});

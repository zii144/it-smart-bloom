import { describe, expect, it } from "vitest";
import {
  IdentityError,
  MAX_NAME_LENGTH,
  identityStorageKey,
  normalizeMobile,
  normalizeName,
  parseGuestIdentity,
} from "@/lib/guest-identity";

describe("parseGuestIdentity", () => {
  it("accepts a name and a Taiwan mobile", () => {
    expect(
      parseGuestIdentity({ name: "張小明", mobile: "0912345678" }),
    ).toEqual({ name: "張小明", mobile: "0912345678" });
  });

  it("normalizes both fields the way road-teacher does", () => {
    expect(
      parseGuestIdentity({ name: "  張小明 ", mobile: "+886 912-345-678" }),
    ).toEqual({ name: "張小明", mobile: "0912345678" });
  });

  it("requires a name", () => {
    expect(() => parseGuestIdentity({ mobile: "0912345678" })).toThrow(
      IdentityError,
    );
    expect(() =>
      parseGuestIdentity({ name: "   ", mobile: "0912345678" }),
    ).toThrow(/姓名/);
  });

  it("requires a Taiwan mobile", () => {
    expect(() => parseGuestIdentity({ name: "張小明" })).toThrow(/手機/);
    expect(() =>
      parseGuestIdentity({ name: "張小明", mobile: "0212345678" }),
    ).toThrow(/台灣手機/);
  });

  it("rejects an over-long name", () => {
    expect(() =>
      parseGuestIdentity({
        name: "名".repeat(MAX_NAME_LENGTH + 1),
        mobile: "0912345678",
      }),
    ).toThrow(/姓名/);
  });

  it("rejects non-string input", () => {
    expect(() => parseGuestIdentity({ name: 1, mobile: 912345678 })).toThrow(
      IdentityError,
    );
  });
});

describe("normalizers", () => {
  it("only trims names, so they match road-teacher's stored value", () => {
    expect(normalizeName("  陳麗娥（Tracy） ")).toBe("陳麗娥（Tracy）");
    expect(normalizeName("王　小明")).toBe("王　小明");
  });

  it.each([
    ["0912 345 678", "0912345678"],
    ["(0912)345-678", "0912345678"],
    ["886912345678", "0912345678"],
  ])("normalizes mobile %p", (raw, expected) => {
    expect(normalizeMobile(raw)).toBe(expected);
  });
});

describe("identityStorageKey", () => {
  it("keys the archive folder by mobile alone", () => {
    expect(identityStorageKey({ mobile: "0912345678" })).toBe(
      "mobile_0912345678",
    );
  });
});

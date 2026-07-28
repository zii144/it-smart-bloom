import { describe, expect, it } from "vitest";
import {
  IdentityError,
  identityStorageKey,
  parseGuestIdentity,
} from "@/lib/guest-identity";

describe("parseGuestIdentity", () => {
  it("accepts a road-teacher Line ID", () => {
    expect(parseGuestIdentity({ lineId: "112-張小明-南投縣" })).toEqual({
      kind: "lineId",
      value: "112-張小明-南投縣",
    });
  });

  it("accepts a Taiwan mobile number", () => {
    expect(parseGuestIdentity({ mobile: "0912-345-678" })).toEqual({
      kind: "mobile",
      value: "0912345678",
    });
  });

  it("rejects filling both fields", () => {
    expect(() =>
      parseGuestIdentity({ lineId: "112-張小明-南投縣", mobile: "0912345678" }),
    ).toThrow(IdentityError);
  });

  it("rejects an empty submission", () => {
    expect(() => parseGuestIdentity({})).toThrow(/請填寫/);
  });

  it("rejects a malformed Line ID", () => {
    expect(() => parseGuestIdentity({ lineId: "張小明" })).toThrow(/格式/);
  });

  it("rejects a non-Taiwan mobile", () => {
    expect(() => parseGuestIdentity({ mobile: "+886912345678" })).toThrow(
      /台灣手機/,
    );
  });

  it("builds a stable storage key", () => {
    expect(
      identityStorageKey({ kind: "lineId", value: "112-張小明-南投縣" }),
    ).toBe("lineId_112-張小明-南投縣");
  });
});

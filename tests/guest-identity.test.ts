import { beforeEach, describe, expect, it } from "vitest";
import {
  IdentityError,
  identityStorageKey,
  MAX_IDENTITY_INPUT_LENGTH,
  maskIdentityValue,
  parseGuestIdentity,
  parseOptionalGuestIdentity,
} from "@/lib/guest-identity";

const MOBILE = "0912345678";

/** `expect(fn).toMatchObject` would match the function, not what it threw. */
function thrownBy(run: () => unknown) {
  try {
    run();
  } catch (error) {
    return error as { code?: string; status?: number };
  }
  throw new Error("expected the call to throw, but it returned");
}

describe("parseGuestIdentity", () => {
  it("accepts a Taiwan mobile number", () => {
    expect(parseGuestIdentity({ mobile: MOBILE })).toEqual({
      kind: "mobile",
      value: MOBILE,
    });
  });

  it("normalizes the separators guests actually type", () => {
    expect(parseGuestIdentity({ mobile: " 0912-345-678 " })).toEqual({
      kind: "mobile",
      value: MOBILE,
    });
  });

  it("reports a missing number as IDENTITY_REQUIRED", () => {
    expect(() => parseGuestIdentity({})).toThrow(IdentityError);
    expect(thrownBy(() => parseGuestIdentity({}))).toMatchObject({
      code: "IDENTITY_REQUIRED",
      status: 400,
    });
  });

  it("reports a malformed number as IDENTITY_INVALID", () => {
    expect(thrownBy(() => parseGuestIdentity({ mobile: "0212345678" }))).toMatchObject({
      code: "IDENTITY_INVALID",
      status: 400,
    });
  });

  it("rejects a non-Taiwan mobile", () => {
    expect(() => parseGuestIdentity({ mobile: "+886912345678" })).toThrow(
      /台灣手機/,
    );
  });

  it("rejects a value that is not a string", () => {
    expect(thrownBy(() => parseGuestIdentity({ mobile: new File([], "a.txt") }))).toMatchObject({ code: "IDENTITY_INVALID" });
  });

  it("rejects an oversized value before it reaches any pattern", () => {
    const huge = "0".repeat(MAX_IDENTITY_INPUT_LENGTH + 1);
    expect(thrownBy(() => parseGuestIdentity({ mobile: huge }))).toMatchObject({
      code: "IDENTITY_TOO_LONG",
      status: 400,
    });
  });
});

describe("parseOptionalGuestIdentity", () => {
  it("treats an absent field as no identity", () => {
    expect(parseOptionalGuestIdentity({})).toBeNull();
    expect(parseOptionalGuestIdentity({ mobile: null })).toBeNull();
  });

  // A form that posts every input unconditionally must not 400 on a blank one.
  it("treats a present-but-blank field as no identity", () => {
    expect(parseOptionalGuestIdentity({ mobile: "" })).toBeNull();
    expect(parseOptionalGuestIdentity({ mobile: "   " })).toBeNull();
  });

  it("still holds a non-blank field to the full rules", () => {
    expect(parseOptionalGuestIdentity({ mobile: MOBILE })).toEqual({
      kind: "mobile",
      value: MOBILE,
    });
    expect(() => parseOptionalGuestIdentity({ mobile: "123" })).toThrow(
      IdentityError,
    );
  });
});

describe("identityStorageKey", () => {
  beforeEach(() => {
    process.env.IDENTITY_KEY_SECRET = "test-identity-secret";
  });

  it("never leaks the number and stays inside every key-length limit", () => {
    const key = identityStorageKey({ kind: "mobile", value: MOBILE });

    expect(key).not.toContain(MOBILE);
    expect(key).toMatch(/^mobile_[0-9a-f]{64}$/);
    // Firestore document ids cap at 1500 bytes, GCS object names at 1024.
    expect(Buffer.byteLength(key)).toBeLessThan(128);
  });

  it("is stable per number and distinct across numbers", () => {
    const a = identityStorageKey({ kind: "mobile", value: MOBILE });
    const again = identityStorageKey({ kind: "mobile", value: MOBILE });
    const b = identityStorageKey({ kind: "mobile", value: "0987654321" });

    expect(a).toBe(again);
    expect(a).not.toBe(b);
  });

  it("is not derivable without the server secret", () => {
    const withOne = identityStorageKey({ kind: "mobile", value: MOBILE });
    process.env.IDENTITY_KEY_SECRET = "a-different-secret";

    expect(identityStorageKey({ kind: "mobile", value: MOBILE })).not.toBe(
      withOne,
    );
  });

  it("refuses to build an unkeyed digest when no secret is configured", () => {
    delete process.env.IDENTITY_KEY_SECRET;
    delete process.env.ADMIN_DASHBOARD_SECRET;

    expect(thrownBy(() => identityStorageKey({ kind: "mobile", value: MOBILE }))).toMatchObject({ code: "IDENTITY_KEY_UNAVAILABLE", status: 503 });
  });
});

describe("maskIdentityValue", () => {
  it("keeps a number recognisable without making it dialable", () => {
    expect(maskIdentityValue(MOBILE)).toBe("0912***678");
  });
});

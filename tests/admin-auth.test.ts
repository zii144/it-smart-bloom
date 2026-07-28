import { afterEach, describe, expect, it } from "vitest";
import {
  createAdminToken,
  resolveAdminAuth,
  verifyAdminToken,
  verifyBasicAuth,
  verifyAdminKey,
} from "@/lib/admin-auth";

afterEach(() => {
  delete process.env.ADMIN_DASHBOARD_SECRET;
});

describe("admin-auth", () => {
  it("reports disabled when the secret is unset", () => {
    expect(resolveAdminAuth({ key: "x" })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("accepts a matching key", () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    expect(verifyAdminKey("s3cret")).toBe(true);
    expect(verifyAdminKey("nope")).toBe(false);
    expect(resolveAdminAuth({ key: "s3cret" })).toEqual({
      ok: true,
      via: "key",
    });
  });

  it("accepts Basic auth for user admin", () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const encoded = Buffer.from("admin:s3cret").toString("base64");
    expect(verifyBasicAuth(`Basic ${encoded}`)).toBe(true);
    expect(
      verifyBasicAuth(`Basic ${Buffer.from("nope:s3cret").toString("base64")}`),
    ).toBe(false);
  });

  it("round-trips a signed cookie token", () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const token = createAdminToken();
    expect(verifyAdminToken(token)).toBe(true);
    expect(verifyAdminToken("0.bad")).toBe(false);
    expect(resolveAdminAuth({ cookieToken: token })).toEqual({
      ok: true,
      via: "cookie",
    });
  });

  it("rejects an expired token", () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const token = createAdminToken(
      "s3cret",
      Date.now() - 12 * 60 * 60 * 1000 - 1_000,
    );
    expect(verifyAdminToken(token)).toBe(false);
  });
});

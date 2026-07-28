import { describe, expect, it } from "vitest";
import { isImageTuningEnabled } from "@/lib/runtime-env";

describe("isImageTuningEnabled", () => {
  it("is off by default outside development", () => {
    expect(isImageTuningEnabled()).toBe(false);
  });

  it.each(["1", "true", "yes", "TRUE", " Yes "])(
    "is on for the explicit flag %s",
    (flag) => {
      process.env.NEXT_PUBLIC_IMAGE_TUNING = flag;
      expect(isImageTuningEnabled()).toBe(true);
    },
  );

  it.each(["0", "false", "no", ""])(
    "stays off for the flag value %s",
    (flag) => {
      process.env.NEXT_PUBLIC_IMAGE_TUNING = flag;
      expect(isImageTuningEnabled()).toBe(false);
    },
  );

  it("is on for Vercel preview deployments", () => {
    process.env.VERCEL_ENV = "preview";
    expect(isImageTuningEnabled()).toBe(true);
  });

  it("is on when only the public preview var is present", () => {
    process.env.NEXT_PUBLIC_VERCEL_ENV = "preview";
    expect(isImageTuningEnabled()).toBe(true);
  });

  it("is off for Vercel production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isImageTuningEnabled()).toBe(false);
  });

  it("keeps the explicit flag winning over production", () => {
    process.env.VERCEL_ENV = "production";
    process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
    expect(isImageTuningEnabled()).toBe(true);
  });
});

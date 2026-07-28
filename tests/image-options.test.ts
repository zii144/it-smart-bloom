import { describe, expect, it } from "vitest";
import {
  defaultImageOptions,
  mimeForOutputFormat,
  parseImageOverrides,
  resolveImageOptions,
} from "@/lib/image-options";

describe("defaultImageOptions", () => {
  it("uses the booth defaults when no env is set", () => {
    expect(defaultImageOptions()).toEqual({
      model: "gpt-image-2",
      quality: "medium",
      size: "1024x1024",
      outputFormat: "jpeg",
      outputCompression: 90,
      fakeGenerate: false,
    });
  });

  it("reads model, quality and size from env", () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1";
    process.env.OPENAI_IMAGE_QUALITY = "high";
    process.env.OPENAI_IMAGE_SIZE = "1024x1536";

    expect(defaultImageOptions()).toMatchObject({
      model: "gpt-image-1",
      quality: "high",
      size: "1024x1536",
    });
  });

  it("falls back to defaults when env holds an unknown value", () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-99";
    process.env.OPENAI_IMAGE_QUALITY = "ultra";
    process.env.OPENAI_IMAGE_SIZE = "9999x9999";

    expect(defaultImageOptions()).toMatchObject({
      model: "gpt-image-2",
      quality: "medium",
      size: "1024x1024",
    });
  });
});

describe("resolveImageOptions", () => {
  it("returns defaults when there are no overrides", () => {
    expect(resolveImageOptions()).toEqual(defaultImageOptions());
    expect(resolveImageOptions(null)).toEqual(defaultImageOptions());
  });

  it("merges a partial override over the defaults", () => {
    expect(resolveImageOptions({ quality: "low", outputFormat: "png" })).toEqual(
      {
        ...defaultImageOptions(),
        quality: "low",
        outputFormat: "png",
      },
    );
  });

  it("accepts every documented option at once", () => {
    expect(
      resolveImageOptions({
        model: "gpt-image-1.5",
        quality: "auto",
        size: "1536x1024",
        outputFormat: "webp",
        outputCompression: 55,
        fakeGenerate: true,
      }),
    ).toEqual({
      model: "gpt-image-1.5",
      quality: "auto",
      size: "1536x1024",
      outputFormat: "webp",
      outputCompression: 55,
      fakeGenerate: true,
    });
  });

  it.each([
    ["model", { model: "dall-e-9" }],
    ["quality", { quality: "supreme" }],
    ["size", { size: "42x42" }],
    ["outputFormat", { outputFormat: "gif" }],
  ])("rejects an unsupported %s", (_label, overrides) => {
    expect(() =>
      resolveImageOptions(overrides as Parameters<typeof resolveImageOptions>[0]),
    ).toThrow();
  });

  it.each([-1, 101, 12.5, Number.NaN])(
    "rejects outputCompression %s",
    (outputCompression) => {
      expect(() => resolveImageOptions({ outputCompression })).toThrow(
        /outputCompression/,
      );
    },
  );

  it.each([0, 100])("accepts boundary compression %i", (outputCompression) => {
    expect(resolveImageOptions({ outputCompression })).toMatchObject({
      outputCompression,
    });
  });
});

describe("parseImageOverrides", () => {
  it("ignores non-object input", () => {
    expect(parseImageOverrides(null)).toEqual({});
    expect(parseImageOverrides("nope")).toEqual({});
    expect(parseImageOverrides(undefined)).toEqual({});
  });

  it("picks up only the known keys", () => {
    expect(
      parseImageOverrides({
        model: "gpt-image-1",
        quality: "low",
        size: "auto",
        outputFormat: "png",
        outputCompression: 70,
        fakeGenerate: true,
        force: true,
        somethingElse: "ignored",
      }),
    ).toEqual({
      model: "gpt-image-1",
      quality: "low",
      size: "auto",
      outputFormat: "png",
      outputCompression: 70,
      fakeGenerate: true,
    });
  });

  it("coerces a numeric string compression", () => {
    expect(parseImageOverrides({ outputCompression: "80" })).toEqual({
      outputCompression: 80,
    });
  });

  it.each([
    ["true", true],
    ["1", true],
    ["false", false],
    ["0", false],
  ])("coerces fakeGenerate %s", (input, expected) => {
    expect(parseImageOverrides({ fakeGenerate: input })).toEqual({
      fakeGenerate: expected,
    });
  });

  it("leaves fakeGenerate unset for unrelated values", () => {
    expect(parseImageOverrides({ fakeGenerate: "maybe" })).toEqual({});
  });
});

describe("mimeForOutputFormat", () => {
  it.each([
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ] as const)("maps %s", (format, mime) => {
    expect(mimeForOutputFormat(format)).toBe(mime);
  });
});

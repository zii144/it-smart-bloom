export const IMAGE_MODELS = [
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
] as const;

export const IMAGE_QUALITIES = ["low", "medium", "high", "auto"] as const;

export const IMAGE_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "2048x2048",
  "2048x1152",
  "1152x2048",
  "auto",
] as const;

export const IMAGE_OUTPUT_FORMATS = ["jpeg", "png", "webp"] as const;

export type ImageModel = (typeof IMAGE_MODELS)[number];
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
export type ImageSize = (typeof IMAGE_SIZES)[number];
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number];

export type ImageGenerationOptions = {
  model: ImageModel;
  quality: ImageQuality;
  size: ImageSize;
  outputFormat: ImageOutputFormat;
  outputCompression: number;
  /** Dev/preview only: skip OpenAI and reuse the source photo. */
  fakeGenerate: boolean;
};

export type ImageGenerationOverrides = Partial<ImageGenerationOptions>;

const QUALITY_HINTS: Record<ImageQuality, string> = {
  low: "最省・最快",
  medium: "均衡",
  high: "最高品質・較貴",
  auto: "由模型決定",
};

const SIZE_HINTS: Record<ImageSize, string> = {
  "1024x1024": "標準方圖・較省",
  "1024x1536": "直式",
  "1536x1024": "橫式",
  "2048x2048": "2K 方圖・較貴",
  "2048x1152": "2K 橫式",
  "1152x2048": "2K 直式",
  auto: "由模型決定",
};

const MODEL_HINTS: Record<ImageModel, string> = {
  "gpt-image-2": "最新・品質最佳",
  "gpt-image-1.5": "前代",
  "gpt-image-1": "較舊・通常較省",
};

function isOneOf<T extends string>(
  value: string,
  options: readonly T[],
): value is T {
  return (options as readonly string[]).includes(value);
}

export function defaultImageOptions(): ImageGenerationOptions {
  const quality = process.env.OPENAI_IMAGE_QUALITY?.trim() ?? "medium";
  const model = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2";
  const size = process.env.OPENAI_IMAGE_SIZE?.trim() || "1024x1024";

  return {
    model: isOneOf(model, IMAGE_MODELS) ? model : "gpt-image-2",
    quality: isOneOf(quality, IMAGE_QUALITIES) ? quality : "medium",
    size: isOneOf(size, IMAGE_SIZES) ? size : "1024x1024",
    outputFormat: "jpeg",
    outputCompression: 90,
    fakeGenerate: false,
  };
}

export function resolveImageOptions(
  overrides?: ImageGenerationOverrides | null,
): ImageGenerationOptions {
  const defaults = defaultImageOptions();
  if (!overrides) return defaults;

  const next: ImageGenerationOptions = { ...defaults };

  if (overrides.model !== undefined) {
    if (!isOneOf(overrides.model, IMAGE_MODELS)) {
      throw new Error("不支援的圖片模型。");
    }
    next.model = overrides.model;
  }

  if (overrides.quality !== undefined) {
    if (!isOneOf(overrides.quality, IMAGE_QUALITIES)) {
      throw new Error("OPENAI_IMAGE_QUALITY 必須是 low、medium、high 或 auto。");
    }
    next.quality = overrides.quality;
  }

  if (overrides.size !== undefined) {
    if (!isOneOf(overrides.size, IMAGE_SIZES)) {
      throw new Error("不支援的圖片尺寸。");
    }
    next.size = overrides.size;
  }

  if (overrides.outputFormat !== undefined) {
    if (!isOneOf(overrides.outputFormat, IMAGE_OUTPUT_FORMATS)) {
      throw new Error("輸出格式必須是 jpeg、png 或 webp。");
    }
    next.outputFormat = overrides.outputFormat;
  }

  if (overrides.outputCompression !== undefined) {
    const compression = Number(overrides.outputCompression);
    if (
      !Number.isInteger(compression) ||
      compression < 0 ||
      compression > 100
    ) {
      throw new Error("outputCompression 必須是 0–100 的整數。");
    }
    next.outputCompression = compression;
  }

  if (overrides.fakeGenerate !== undefined) {
    next.fakeGenerate = Boolean(overrides.fakeGenerate);
  }

  return next;
}

export function mimeForOutputFormat(format: ImageOutputFormat) {
  switch (format) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

export function modelHint(model: ImageModel) {
  return MODEL_HINTS[model];
}

export function qualityHint(quality: ImageQuality) {
  return QUALITY_HINTS[quality];
}

export function sizeHint(size: ImageSize) {
  return SIZE_HINTS[size];
}

export function parseImageOverrides(value: unknown): ImageGenerationOverrides {
  if (!value || typeof value !== "object") {
    return {};
  }

  const body = value as Record<string, unknown>;
  const overrides: ImageGenerationOverrides = {};

  if (typeof body.model === "string") {
    overrides.model = body.model as ImageModel;
  }
  if (typeof body.quality === "string") {
    overrides.quality = body.quality as ImageQuality;
  }
  if (typeof body.size === "string") {
    overrides.size = body.size as ImageSize;
  }
  if (typeof body.outputFormat === "string") {
    overrides.outputFormat = body.outputFormat as ImageOutputFormat;
  }
  if (
    typeof body.outputCompression === "number" ||
    typeof body.outputCompression === "string"
  ) {
    overrides.outputCompression = Number(body.outputCompression);
  }
  if (typeof body.fakeGenerate === "boolean") {
    overrides.fakeGenerate = body.fakeGenerate;
  } else if (body.fakeGenerate === "true" || body.fakeGenerate === "1") {
    overrides.fakeGenerate = true;
  } else if (body.fakeGenerate === "false" || body.fakeGenerate === "0") {
    overrides.fakeGenerate = false;
  }

  return overrides;
}

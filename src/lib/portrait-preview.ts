/**
 * Vercel functions cap a response body at 4.5 MB, and an admin's fine-tuned
 * original can be far bigger. Every image a function streams to a browser is
 * this preview instead; the original only ever leaves through a signed
 * Storage URL (see `portrait-delivery.ts`).
 */
export const PREVIEW_MAX_EDGE = 1280;
export const PREVIEW_MIME = "image/jpeg";
const PREVIEW_QUALITY = 84;
/**
 * About 10,000 × 10,000: room for a 4× upscale of the largest generated size,
 * while refusing decompression bombs before they exhaust function memory.
 */
const MAX_INPUT_PIXELS = 100_000_000;

export class PreviewError extends Error {
  constructor(message = "無法讀取這張圖片，請確認檔案沒有損毀。") {
    super(message);
    this.name = "PreviewError";
  }
}

/**
 * A JPEG no larger than PREVIEW_MAX_EDGE on either side, EXIF orientation
 * applied. Fully decodes the input, so it doubles as the "is this really an
 * image" check. sharp is a native module, so it loads here on first use
 * rather than with every route that imports the archive.
 */
export async function compressPreview(bytes: Buffer): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  try {
    return await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      // Transparent PNG edits would turn black in JPEG; the invitation is paper white.
      .flatten({ background: "#fffdf7" })
      .jpeg({ quality: PREVIEW_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new PreviewError("圖片解析度過高（上限約 1 億像素），請縮小後再上傳。");
    }
    throw new PreviewError();
  }
}

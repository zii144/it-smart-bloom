/**
 * Image-tuning UI/API is enabled for:
 * - local `next dev` (NODE_ENV=development)
 * - explicit NEXT_PUBLIC_IMAGE_TUNING=1|true
 * - Vercel Preview deployments (non-production branches)
 *
 * It stays disabled for Vercel Production (usually `main` after merge).
 */
export function isImageTuningEnabled() {
  const flag = process.env.NEXT_PUBLIC_IMAGE_TUNING?.trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") {
    return true;
  }

  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const vercelEnv =
    process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV;

  return vercelEnv === "preview";
}

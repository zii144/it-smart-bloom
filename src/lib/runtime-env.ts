/**
 * Image-tuning UI/API is enabled for:
 * - local `next dev` (NODE_ENV=development)
 * - Vercel Preview deployments (non-production branches)
 *
 * It stays disabled for Vercel Production (usually `main` after merge).
 */
export function isImageTuningEnabled() {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const vercelEnv =
    process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV;

  return vercelEnv === "preview";
}

/**
 * Shared by the admin panel and the server, so it must stay free of server
 * imports.
 *
 * Vercel rejects function request and response bodies over 4.5 MB before our
 * code runs. Anything a function streams stays under this; bigger files go
 * straight between the browser and Storage through signed URLs.
 */
export const FUNCTION_BODY_SAFE_BYTES = 4 * 1024 * 1024;

/** Upper bound for an admin's fine-tuned original uploaded straight to Storage. */
export const MAX_ADJUSTED_BYTES = 40 * 1024 * 1024;

export const ADJUSTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AdjustedMime = (typeof ADJUSTED_MIME_TYPES)[number];

export function isAdjustedMime(value: unknown): value is AdjustedMime {
  return (ADJUSTED_MIME_TYPES as readonly unknown[]).includes(value);
}

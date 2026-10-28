/**
 * Road-teacher feature flags shared by server routes and client UI.
 * Kept free of "use client" so API handlers can import them safely.
 */

export function isRoadTeacherMockEnabled() {
  if (process.env.NODE_ENV === "production") return false;
  const flag = process.env.NEXT_PUBLIC_RT_MOCK?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * Enable the production UI only when all RT configuration is present and valid.
 */
export function isRoadTeacherAvatarUiEnabled() {
  if (!isRoadTeacherAvatarEnabled()) return false;
  return isRoadTeacherMockEnabled() || getRoadTeacherConfig() !== null;
}

/** Explicit rollout switch: configuring RT must not accidentally expose the UI. */
export function isRoadTeacherAvatarEnabled() {
  const flag = process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED?.trim().toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

/** Public RT configuration only; never use Bloom's Firebase project for sign-in. */
export function getRoadTeacherConfig() {
  const apiKey = process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID?.trim();
  const endpoint = process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL?.trim();
  if (!apiKey || !authDomain || !projectId || !endpoint) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash)
      return null;
    return { apiKey, authDomain, projectId, endpoint: url.toString() };
  } catch {
    return null;
  }
}

/** Legacy LINE/mobile claim + static-key avatar POST — off unless explicitly re-enabled. */
export function isLegacyIdentityClaimEnabled() {
  const flag = process.env.ALLOW_LEGACY_IDENTITY_CLAIM?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * Road-teacher feature flags shared by server routes and client UI.
 * Kept free of "use client" so API handlers can import them safely.
 */

export function isRoadTeacherMockEnabled() {
  const flag = process.env.NEXT_PUBLIC_RT_MOCK?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/**
 * Avatar replacement UI stays hidden until the real RT bridge is ready.
 * Mock mode is the only supported path today (see road-teacher-auth-plan.md).
 */
export function isRoadTeacherAvatarUiEnabled() {
  return isRoadTeacherMockEnabled();
}

/** Legacy LINE/mobile claim + static-key avatar POST — off unless explicitly re-enabled. */
export function isLegacyIdentityClaimEnabled() {
  const flag = process.env.ALLOW_LEGACY_IDENTITY_CLAIM?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

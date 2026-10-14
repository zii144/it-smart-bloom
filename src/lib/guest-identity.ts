/**
 * The guest's identity at the booth: their 姓名 and 手機號碼. Road-teacher
 * matches the pair against teachers.displayName + teachers.mobile when the
 * guest sets the portrait as their avatar, so the normalisation here mirrors
 * road-teacher's (functions/src/bloom-identity-avatar-core.ts) exactly.
 */
export type GuestIdentity = { name: string; mobile: string };

export const MAX_NAME_LENGTH = 30;

/** NFKC (full-width → half-width), trimmed, inner whitespace collapsed. */
export function normalizeName(raw: string) {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Taiwan mobile as `09xxxxxxxx`: drops spaces, dashes, brackets; +886 → 0. */
export function normalizeMobile(raw: string) {
  let digits = raw.replace(/[\s\-()]/g, "");
  if (digits.startsWith("+886")) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith("886") && digits.length === 12) {
    digits = `0${digits.slice(3)}`;
  }
  return digits;
}

export function isValidName(value: string) {
  return value.length > 0 && value.length <= MAX_NAME_LENGTH;
}

export function isValidMobile(value: string) {
  return /^09\d{8}$/.test(value);
}

export const NAME_ERROR = "請填寫姓名（與路老師系統登記的姓名相同）。";
export const MOBILE_ERROR = "請輸入台灣手機號碼，例如 0912345678。";

/** Validates and normalises both fields; throws IdentityError on the first problem. */
export function parseGuestIdentity(input: {
  name?: unknown;
  mobile?: unknown;
}): GuestIdentity {
  const name = typeof input.name === "string" ? normalizeName(input.name) : "";
  const mobile =
    typeof input.mobile === "string" ? normalizeMobile(input.mobile) : "";

  if (!isValidName(name)) throw new IdentityError(NAME_ERROR);
  if (!isValidMobile(mobile)) throw new IdentityError(MOBILE_ERROR);

  return { name, mobile };
}

/**
 * Storage / Firestore key for a guest's archive folder. Keyed by the mobile
 * alone: one person, one folder, even if they type their name differently on
 * another visit. The mobile is already digits-only after validation.
 */
export function identityStorageKey(identity: Pick<GuestIdentity, "mobile">) {
  return `mobile_${identity.mobile}`;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

/**
 * `lineId` is kept only so sessions archived before the switch to 姓名 + 電話
 * still load; nothing accepts a LINE ID as input anymore.
 */
export type GuestIdentity =
  | { kind: "lineId"; value: string }
  | { kind: "mobile"; value: string };

/** 台灣門號：09 開頭共 10 碼 */
const MOBILE_PATTERN = /^09\d{8}$/;
const MAX_GUEST_NAME_LENGTH = 30;

export function normalizeGuestName(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

export function isValidGuestName(value: string) {
  const length = [...value].length;
  return length > 0 && length <= MAX_GUEST_NAME_LENGTH;
}

export function normalizeMobile(raw: string) {
  return raw.trim().replace(/[\s-]/g, "");
}

export function isValidMobile(value: string) {
  return MOBILE_PATTERN.test(value);
}

export function parseGuestIdentity(input: { mobile?: unknown }): GuestIdentity {
  const mobile =
    typeof input.mobile === "string" ? normalizeMobile(input.mobile) : "";

  if (!mobile) {
    throw new IdentityError("請填寫手機號碼。");
  }

  if (!isValidMobile(mobile)) {
    throw new IdentityError("請輸入台灣手機號碼，例如 0912345678。");
  }

  return { kind: "mobile", value: mobile };
}

/** Safe Storage / Firestore path segment for an identity value. */
export function identityStorageKey(identity: GuestIdentity) {
  return `${identity.kind}_${identity.value.replace(/[^\w一-鿿-]/gu, "_")}`;
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

import { createHmac } from "node:crypto";
import { AppError, ConfigError, type ErrorCode } from "@/lib/api-errors";

/**
 * Guests are identified by their own Taiwan mobile number — the one channel the
 * road-teacher system can deliver a finished portrait back through.
 */
export type GuestIdentityKind = "mobile";
export type GuestIdentity = { kind: GuestIdentityKind; value: string };

/** 台灣門號：09 開頭共 10 碼 */
const MOBILE_PATTERN = /^09\d{8}$/;

/**
 * Bound the raw input before any parsing runs. A Taiwan mobile is 10 digits;
 * 32 characters leaves room for the separators guests type while keeping every
 * downstream value fixed-size.
 */
export const MAX_IDENTITY_INPUT_LENGTH = 32;

export class IdentityError extends AppError {
  constructor(message: string, code: ErrorCode = "IDENTITY_INVALID") {
    super(message, 400, code);
    this.name = "IdentityError";
  }
}

export function normalizeMobile(raw: string) {
  return raw.trim().replace(/[\s-]/g, "");
}

export function isValidMobile(value: string) {
  return MOBILE_PATTERN.test(value);
}

/**
 * Parses the one identifier a guest supplies. Throws for anything that is not a
 * usable Taiwan mobile — including absent input, which callers that treat the
 * field as optional should filter out with `parseOptionalGuestIdentity` first.
 */
export function parseGuestIdentity(input: { mobile?: unknown }): GuestIdentity {
  const raw = input.mobile;

  if (raw === undefined || raw === null || raw === "") {
    throw new IdentityError("請填寫手機號碼。", "IDENTITY_REQUIRED");
  }

  if (typeof raw !== "string") {
    throw new IdentityError("手機號碼格式不正確。", "IDENTITY_INVALID");
  }

  // Checked before normalizing so an oversized value never reaches a regex.
  if (raw.length > MAX_IDENTITY_INPUT_LENGTH) {
    throw new IdentityError(
      `手機號碼不得超過 ${MAX_IDENTITY_INPUT_LENGTH} 個字元。`,
      "IDENTITY_TOO_LONG",
    );
  }

  const mobile = normalizeMobile(raw);

  if (!mobile) {
    throw new IdentityError("請填寫手機號碼。", "IDENTITY_REQUIRED");
  }

  if (!isValidMobile(mobile)) {
    throw new IdentityError(
      "請輸入台灣手機號碼，例如 0912345678。",
      "IDENTITY_INVALID",
    );
  }

  return { kind: "mobile", value: mobile };
}

/**
 * The optional-field seam. A field that is absent, or present but blank, means
 * "no identity" rather than a validation failure — so a form can post the input
 * unconditionally. Anything non-blank is held to the full rules above.
 */
export function parseOptionalGuestIdentity(input: {
  mobile?: unknown;
}): GuestIdentity | null {
  const raw = input.mobile;

  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;

  return parseGuestIdentity(input);
}

function identityKeySecret() {
  return (
    process.env.IDENTITY_KEY_SECRET?.trim() ||
    // The admin secret is already required for any deployment that can read the
    // archive, so it is a safe default rather than a silent downgrade to an
    // unkeyed digest.
    process.env.ADMIN_DASHBOARD_SECRET?.trim() ||
    ""
  );
}

export function isIdentityKeyConfigured() {
  return Boolean(identityKeySecret());
}

/**
 * Storage / Firestore key for an identity.
 *
 * The phone number itself is PII and only 10^8 values wide, so using it as a
 * document id would make the archive enumerable by anyone who could guess or
 * list keys. The key is an HMAC under a server-side secret instead: a fixed 64
 * hex characters (far inside Firestore's 1500-byte document id and Cloud
 * Storage's 1024-byte object-name limits), injective in practice, and not
 * derivable from the phone number without the secret.
 *
 * Rotating IDENTITY_KEY_SECRET orphans every previously written identity
 * document, so treat it as permanent for a deployment.
 */
export function identityStorageKey(identity: GuestIdentity) {
  const secret = identityKeySecret();
  if (!secret) {
    throw new ConfigError(
      "尚未設定 IDENTITY_KEY_SECRET，無法建立身分索引。",
      "IDENTITY_KEY_UNAVAILABLE",
    );
  }

  const digest = createHmac("sha256", secret)
    .update(`bloom-identity-v1:${identity.kind}:${identity.value}`)
    .digest("hex");

  return `${identity.kind}_${digest}`;
}

/** Admin-facing display value: enough to recognise a guest, not to dial them. */
export function maskIdentityValue(value: string) {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(value.length - 7)}${value.slice(-3)}`;
}

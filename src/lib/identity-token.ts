import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, ConfigError } from "@/lib/api-errors";
import {
  isValidMobile,
  type GuestIdentity,
} from "@/lib/guest-identity";

/**
 * Proof that the person at the booth answered the road-teacher name challenge
 * for this number.
 *
 * The booth holds it the way a browser holds a login cookie: signed by the
 * server, carrying its own expiry, and useless once that expiry passes. A raw
 * phone number posted to `POST /api/sessions` is no longer accepted — an
 * identity can only reach a session through a token this module issued, which
 * is what makes the binding strong rather than self-asserted.
 */

/** Long enough to type a number, answer, and take a photo; short enough to expire on a shared booth. */
export const IDENTITY_TOKEN_TTL_MS = 15 * 60 * 1000;

const VERSION = "v1";

type TokenPayload = {
  kind: GuestIdentity["kind"];
  value: string;
  expiresAt: number;
};

export class IdentityTokenError extends AppError {
  constructor(message = "驗證已逾期，請重新驗證手機號碼。") {
    super(message, 400, "IDENTITY_TOKEN_INVALID");
    this.name = "IdentityTokenError";
  }
}

function tokenSecret() {
  const secret =
    process.env.IDENTITY_KEY_SECRET?.trim() ||
    process.env.ADMIN_DASHBOARD_SECRET?.trim() ||
    "";

  if (!secret) {
    throw new ConfigError(
      "尚未設定 IDENTITY_KEY_SECRET，無法簽發身分驗證憑證。",
      "IDENTITY_KEY_UNAVAILABLE",
    );
  }

  return secret;
}

function sign(body: string) {
  return createHmac("sha256", tokenSecret())
    .update(`bloom-identity-token-${VERSION}:${body}`)
    .digest("base64url");
}

export function issueIdentityToken(
  identity: GuestIdentity,
  now = Date.now(),
): { token: string; expiresAt: number } {
  const expiresAt = now + IDENTITY_TOKEN_TTL_MS;
  const payload: TokenPayload = {
    kind: identity.kind,
    value: identity.value,
    expiresAt,
  };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return { token: `${VERSION}.${body}.${sign(body)}`, expiresAt };
}

/**
 * Returns the identity a token vouches for, or throws. Signature is checked
 * before anything in the payload is trusted, in constant time.
 */
export function readIdentityToken(
  token: unknown,
  now = Date.now(),
): GuestIdentity {
  if (typeof token !== "string" || !token) throw new IdentityTokenError();

  const [version, body, signature] = token.split(".");
  if (version !== VERSION || !body || !signature) throw new IdentityTokenError();

  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    throw new IdentityTokenError();
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as TokenPayload;
  } catch {
    throw new IdentityTokenError();
  }

  if (typeof payload.expiresAt !== "number" || payload.expiresAt <= now) {
    throw new IdentityTokenError();
  }

  if (payload.kind !== "mobile" || !isValidMobile(payload.value)) {
    throw new IdentityTokenError();
  }

  return { kind: payload.kind, value: payload.value };
}

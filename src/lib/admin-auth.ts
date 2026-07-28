import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const ADMIN_COOKIE_NAME = "bloom_admin";
export const ADMIN_COOKIE_MAX_AGE_SEC = 12 * 60 * 60;

export function getAdminSecret() {
  return process.env.ADMIN_DASHBOARD_SECRET?.trim() || "";
}

export function isAdminDashboardEnabled() {
  return Boolean(getAdminSecret());
}

function signPayload(secret: string, payload: string) {
  return createHmac("sha256", secret)
    .update(`bloom-admin-v1:${payload}`)
    .digest("base64url");
}

export function createAdminToken(
  secret = getAdminSecret(),
  now = Date.now(),
) {
  if (!secret) {
    throw new Error("ADMIN_DASHBOARD_SECRET is not configured.");
  }
  const expiresAt = String(now + ADMIN_COOKIE_MAX_AGE_SEC * 1000);
  return `${expiresAt}.${signPayload(secret, expiresAt)}`;
}

export function verifyAdminToken(
  token: string | undefined | null,
  secret = getAdminSecret(),
) {
  if (!token || !secret) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;
  if (!/^\d+$/.test(expiresAt)) return false;
  if (Date.now() > Number(expiresAt)) return false;

  const expected = signPayload(secret, expiresAt);
  try {
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function safeEqualString(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Accepts `Authorization: Basic admin:<secret>` (username must be admin). */
export function verifyBasicAuth(
  authorization: string | null | undefined,
  secret = getAdminSecret(),
) {
  if (!authorization || !secret) return false;
  const [scheme, encoded] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return false;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    if (colon < 0) return false;
    const username = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);
    return username === "admin" && safeEqualString(password, secret);
  } catch {
    return false;
  }
}

export function verifyAdminKey(
  key: string | null | undefined,
  secret = getAdminSecret(),
) {
  if (!key || !secret) return false;
  return safeEqualString(key, secret);
}

export type AdminAuthResult =
  | { ok: true; via: "cookie" | "basic" | "key" }
  | { ok: false; reason: "disabled" | "unauthorized" };

/**
 * Resolve admin access from cookie, Basic auth, or an explicit key
 * (query/body). Does not set cookies — callers do that after a key login.
 */
export function resolveAdminAuth(input: {
  cookieToken?: string | null;
  authorization?: string | null;
  key?: string | null;
}): AdminAuthResult {
  if (!isAdminDashboardEnabled()) {
    return { ok: false, reason: "disabled" };
  }

  if (verifyAdminToken(input.cookieToken)) {
    return { ok: true, via: "cookie" };
  }
  if (verifyBasicAuth(input.authorization)) {
    return { ok: true, via: "basic" };
  }
  if (verifyAdminKey(input.key)) {
    return { ok: true, via: "key" };
  }
  return { ok: false, reason: "unauthorized" };
}

export function adminCookieOptions() {
  return {
    name: ADMIN_COOKIE_NAME,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ADMIN_COOKIE_MAX_AGE_SEC,
  };
}

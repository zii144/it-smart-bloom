import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAdminSecret, resolveAdminAuth, ADMIN_COOKIE_NAME } from "@/lib/admin-auth";

export const DISPLAY_COOKIE = "bloom_seat_display";
export const DISPLAY_MAX_AGE = 12 * 60 * 60;

function signature(payload: string) {
  return createHmac("sha256", getAdminSecret()).update(`bloom-seat-display-v1:${payload}`).digest("base64url");
}

export function createDisplaySession(now = Date.now()) {
  if (!getAdminSecret()) throw new Error("Admin access is not configured");
  const expiresAt = now + DISPLAY_MAX_AGE * 1000;
  const id = randomBytes(16).toString("hex");
  const payload = `${expiresAt}.${id}`;
  return { token: `${payload}.${signature(payload)}`, id, expiresAt };
}

export function verifyDisplaySession(token: string | null, now = Date.now()) {
  if (!getAdminSecret() || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [expiry, id, mac] = parts;
  const expiresAt = Number(expiry);
  if (!/^\d+$/.test(expiry) || !/^[a-f0-9]{32}$/.test(id) || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;
  const expected = Buffer.from(signature(`${expiry}.${id}`));
  const received = Buffer.from(mac);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  return { id, expiresAt };
}

export function requestCookie(request: Request, name: string) {
  const value = (request.headers.get("cookie") ?? "").split(";")
    .map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  try { return value ? decodeURIComponent(value.slice(name.length + 1)) : null; }
  catch { return null; }
}

export function displaySessionFromRequest(request: Request) {
  return verifyDisplaySession(requestCookie(request, DISPLAY_COOKIE));
}

export function displayAdminAuth(request: Request, key?: string | null) {
  return resolveAdminAuth({
    cookieToken: requestCookie(request, ADMIN_COOKIE_NAME),
    authorization: request.headers.get("authorization"),
    key,
  });
}

export function isDisplaySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // CLI clients authenticate explicitly.
  return origin === new URL(request.url).origin;
}

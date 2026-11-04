import { NextResponse } from "next/server";
import { getFirebaseApp } from "@/lib/firebase-admin";
import { firebasePublicConfig } from "@/lib/firebase-public-config";
import {
  createDisplaySession, displayAdminAuth, displaySessionFromRequest,
  DISPLAY_COOKIE, DISPLAY_MAX_AGE, isDisplaySameOrigin,
} from "@/lib/seat-status-auth";
import { ensureSeatStatusReady } from "@/lib/seat-status-store";

export const runtime = "nodejs";
export const maxDuration = 300;
const NO_STORE = { "Cache-Control": "private, no-store" };

function emulatorAddress(value: string | undefined) {
  if (!value) return null;
  const url = new URL(`http://${value}`);
  return { host: url.hostname, port: Number(url.port) };
}

/** Staff authorize a read-only screen; subsequent exchanges keep its fixed expiry. */
export async function POST(request: Request) {
  if (!isDisplaySameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  const body = await request.json().catch(() => null) as { key?: unknown } | null;
  const existing = displaySessionFromRequest(request);
  const auth = displayAdminAuth(request, typeof body?.key === "string" ? body.key : null);
  if (!existing && !auth.ok) {
    return NextResponse.json({ error: auth.reason === "disabled" ? "Not found" : "請輸入工作人員密碼。" }, {
      status: auth.reason === "disabled" ? 404 : 401, headers: NO_STORE,
    });
  }
  const session = existing ?? createDisplaySession();
  try {
    await ensureSeatStatusReady();
    const app = getFirebaseApp();
    if (!app) throw new Error("Firebase is not configured");
    let customToken: string | null = null;
    try {
      // Auth is optional for the polling fallback, including module-load failures.
      const { getAuth } = await import("firebase-admin/auth");
      customToken = await getAuth(app).createCustomToken(`seat-display-${session.id}`, {
        seatStatusDisplay: true, seatStatusExpiresAt: session.expiresAt,
      });
    } catch {
      // A missing Auth setup must not prevent the authenticated polling fallback.
      console.warn("Seat display token unavailable; using authenticated polling.");
    }
    const response = NextResponse.json({
      customToken,
      expiresAt: session.expiresAt,
      firebaseConfig: { ...firebasePublicConfig, projectId: app.options.projectId },
      emulators: {
        firestore: emulatorAddress(process.env.FIRESTORE_EMULATOR_HOST),
        auth: emulatorAddress(process.env.FIREBASE_AUTH_EMULATOR_HOST),
      },
    }, { headers: NO_STORE });
    if (!existing) {
      response.cookies.set(DISPLAY_COOKIE, (session as ReturnType<typeof createDisplaySession>).token, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
        path: "/api/seat-status", maxAge: DISPLAY_MAX_AGE,
      });
    }
    return response;
  } catch (error) {
    console.error("Failed to prepare seat display:", error);
    return NextResponse.json({ error: "暫時無法連線座位看板，請稍後重試。" }, { status: 503, headers: NO_STORE });
  }
}

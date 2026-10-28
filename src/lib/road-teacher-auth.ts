"use client";

/**
 * Road-teacher (路老師) sign-in for the avatar replacement flow.
 *
 * The real implementation signs the guest in against the road-teacher
 * Firebase project (browser → Google identitytoolkit; the password never
 * touches Bloom servers) and returns the Firebase ID token. A mock provider
 * remains available via NEXT_PUBLIC_RT_MOCK only outside production builds.
 *
 * This module is deliberately the only place that ever handles the password.
 * See docs/road-teacher-auth-plan.md for the cross-system contract.
 */

import {
  getRoadTeacherConfig,
  isRoadTeacherMockEnabled,
} from "@/lib/road-teacher-flags";
import type { Auth } from "firebase/auth";

let authPromise: Promise<Auth> | null = null;

async function roadTeacherAuth() {
  const config = getRoadTeacherConfig();
  if (!config) throw new Error("路老師系統尚未開通，請稍後再試。");
  authPromise ??= (async () => {
    const { getApps, initializeApp } = await import("firebase/app");
    const { initializeAuth, inMemoryPersistence } =
      await import("firebase/auth");
    const app =
      getApps().find((item) => item.name === "road-teacher") ??
      initializeApp(
        {
          apiKey: config.apiKey,
          authDomain: config.authDomain,
          projectId: config.projectId,
        },
        "road-teacher",
      );
    return initializeAuth(app, { persistence: inMemoryPersistence });
  })().catch((error) => {
    authPromise = null;
    throw error;
  });
  return authPromise;
}

export {
  isLegacyIdentityClaimEnabled,
  isRoadTeacherAvatarUiEnabled,
  isRoadTeacherMockEnabled,
} from "@/lib/road-teacher-flags";

const DEFAULT_MOCK_DELAY_MS = 700;

/** Firebase-shaped auth error so the mock exercises the same mapping. */
export class RoadTeacherAuthError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = "RoadTeacherAuthError";
    this.code = code;
  }
}

/** Tests set NEXT_PUBLIC_RT_MOCK_DELAY_MS=0, mirroring FAKE_GENERATE_DELAY_MS. */
function mockDelayMs() {
  const raw = process.env.NEXT_PUBLIC_RT_MOCK_DELAY_MS?.trim();
  if (raw === undefined || raw === "") return DEFAULT_MOCK_DELAY_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_MOCK_DELAY_MS;
  return parsed;
}

/**
 * Mock rules, chosen to exercise every guest-visible failure state:
 * - email without "@"        → auth/invalid-email
 * - password "wrong" or <6   → auth/invalid-credential
 * - email starting "locked"  → auth/too-many-requests
 * - email starting "disabled"→ auth/user-disabled
 * - anything else            → resolves with a fake ID token
 */
async function mockSignIn(email: string, password: string) {
  const delay = mockDelayMs();
  if (delay > 0) {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) {
    throw new RoadTeacherAuthError("auth/invalid-email");
  }
  if (normalized.startsWith("locked")) {
    throw new RoadTeacherAuthError("auth/too-many-requests");
  }
  if (normalized.startsWith("disabled")) {
    throw new RoadTeacherAuthError("auth/user-disabled");
  }
  if (password === "wrong" || password.length < 6) {
    throw new RoadTeacherAuthError("auth/invalid-credential");
  }

  return `mock-rt-idtoken-${crypto.randomUUID()}`;
}

/**
 * Signs in and resolves with the road-teacher ID token. The caller must pair
 * this with forgetRoadTeacherSession() in a finally block: booth handsets get
 * passed around, so no RT session may outlive the request that needed it.
 */
export async function signInToRoadTeacher(email: string, password: string) {
  if (isRoadTeacherMockEnabled()) {
    return mockSignIn(email, password);
  }

  const auth = await roadTeacherAuth();
  const { signInWithEmailAndPassword, signOut } = await import("firebase/auth");
  try {
    const credential = await signInWithEmailAndPassword(
      auth,
      email.trim(),
      password,
    );
    return await credential.user.getIdToken();
  } catch (error) {
    await signOut(auth).catch(() => {});
    throw error;
  }
}

export async function forgetRoadTeacherSession() {
  if (!authPromise) return;
  const { signOut } = await import("firebase/auth");
  await signOut(await authPromise);
}

/**
 * Guest-facing Chinese messages for auth failures. `user-not-found` maps to
 * the same text as a wrong password on purpose — the form must not be an
 * account-enumeration oracle.
 */
export function authErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === "string" && code.startsWith("auth/")) {
    switch (code) {
      case "auth/invalid-credential":
      case "auth/wrong-password":
      case "auth/user-not-found":
        return "帳號或密碼不正確。";
      case "auth/invalid-email":
        return "請輸入有效的電子郵件。";
      case "auth/too-many-requests":
        return "嘗試次數過多，請稍後再試。";
      case "auth/user-disabled":
        return "此帳號已停用，請聯絡路老師系統管理員。";
      case "auth/network-request-failed":
        return "網路連線不穩，請稍後再試。";
      default:
        return "登入失敗，請稍後再試。";
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "路老師系統暫時無法使用。";
}

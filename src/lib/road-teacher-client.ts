"use client";

/**
 * Client orchestration for the avatar replacement flow:
 * sign in → obtain a portrait URL → POST it to the road-teacher endpoint.
 *
 * Mock mode (NEXT_PUBLIC_RT_MOCK, dev builds) targets the local
 * /api/dev/set-avatar stub and skips the single-use portrait ticket, which
 * arrives with the backend phase (docs/road-teacher-auth-plan.md §4 Phase 1).
 * The real path is already written against that plan so flipping modes later
 * does not change this module's call sites.
 */

import {
  forgetRoadTeacherSession,
  isRoadTeacherMockEnabled,
  signInToRoadTeacher,
} from "@/lib/road-teacher-auth";

export type AvatarReplaceResult = {
  /** True when the dev stub answered — the UI must say so, never fake success. */
  mock: boolean;
};

function roadTeacherEndpoint(): string | null {
  if (isRoadTeacherMockEnabled()) {
    return "/api/dev/set-avatar";
  }
  return process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL?.trim() || null;
}

async function mintPortraitUrl(sessionId: string): Promise<string> {
  if (isRoadTeacherMockEnabled()) {
    // The stub runs on this origin and can read the session image directly.
    return new URL(
      `/api/sessions/${sessionId}/image?kind=result`,
      window.location.origin,
    ).toString();
  }

  const response = await fetch(`/api/sessions/${sessionId}/portrait-token`, {
    method: "POST",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    url?: string;
    error?: string;
  };
  if (!response.ok || !payload.url) {
    throw new Error(payload.error || "無法建立圖片連結。");
  }
  return payload.url;
}

/**
 * Fire-and-forget ops bookkeeping for the admin dashboard. Client-reported
 * and therefore forgeable — never a security control. The route lands with
 * the backend phase; a 404 until then is harmless.
 */
function reportOutcome(
  sessionId: string,
  outcome: { ok: true } | { ok: false; error: string },
) {
  void fetch(`/api/sessions/${sessionId}/avatar-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(outcome),
  }).catch(() => {});
}

export async function replaceRoadTeacherAvatar(input: {
  sessionId: string;
  email: string;
  password: string;
}): Promise<AvatarReplaceResult> {
  const endpoint = roadTeacherEndpoint();
  if (!endpoint) {
    throw new Error("路老師系統尚未開通，請稍後再試。");
  }

  // A sign-in failure is the guest's typo, not an avatar request — nothing is
  // reported to the dashboard for it.
  const idToken = await signInToRoadTeacher(input.email, input.password);

  try {
    const portraitUrl = await mintPortraitUrl(input.sessionId);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ portraitUrl, sessionId: input.sessionId }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      mock?: boolean;
    };
    if (!response.ok) {
      throw new Error(payload.error || "路老師系統暫時無法使用。");
    }

    reportOutcome(input.sessionId, { ok: true });
    return { mock: payload.mock === true };
  } catch (error) {
    reportOutcome(input.sessionId, {
      ok: false,
      error:
        error instanceof Error ? error.message : "路老師系統暫時無法使用。",
    });
    throw error;
  } finally {
    // Booth handsets get passed around: the RT session must not outlive this.
    await forgetRoadTeacherSession();
  }
}

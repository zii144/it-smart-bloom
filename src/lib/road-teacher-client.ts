"use client";

/**
 * Client orchestration for the avatar replacement flow:
 * sign in → obtain a portrait URL → POST it to the road-teacher endpoint.
 *
 * Mock mode (NEXT_PUBLIC_RT_MOCK, dev builds) targets the local
 * /api/dev/set-avatar stub. Production transfers only a short-lived,
 * single-use portrait capability and sends the RT ID token directly to RT.
 */

import {
  forgetRoadTeacherSession,
  isRoadTeacherMockEnabled,
  signInToRoadTeacher,
} from "@/lib/road-teacher-auth";
import {
  getRoadTeacherConfig,
  isRoadTeacherAvatarUiEnabled,
} from "@/lib/road-teacher-flags";

export type AvatarPortraitSource =
  | { sessionId: string; checkInToken?: never }
  | { sessionId?: never; checkInToken: string };

export type AvatarReplaceResult = {
  /** True when the dev stub answered — the UI must say so, never fake success. */
  mock: boolean;
};

/** Mobile requests must resolve so the guest can retry and auth can be cleared. */
async function fetchForAvatar(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new Error("網路連線不穩，請稍後再試。");
  } finally {
    clearTimeout(timeout);
  }
}

function roadTeacherEndpoint(): string | null {
  if (!isRoadTeacherAvatarUiEnabled()) return null;
  if (isRoadTeacherMockEnabled()) {
    return "/api/dev/set-avatar";
  }
  return getRoadTeacherConfig()?.endpoint ?? null;
}

function sourcePath(source: AvatarPortraitSource) {
  if (source.checkInToken)
    return `/api/check-in/portrait/${encodeURIComponent(source.checkInToken)}`;
  return `/api/sessions/${encodeURIComponent(source.sessionId!)}`;
}

async function mintPortraitUrl(source: AvatarPortraitSource): Promise<string> {
  if (isRoadTeacherMockEnabled()) {
    // The stub runs on this origin and can read the session image directly.
    return new URL(
      source.checkInToken
        ? sourcePath(source)
        : `${sourcePath(source)}/image?kind=result`,
      window.location.origin,
    ).toString();
  }

  const response = await fetchForAvatar(
    `${sourcePath(source)}/${source.checkInToken ? "avatar-token" : "portrait-token"}`,
    {
      method: "POST",
      cache: "no-store",
    },
  );
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
 * and therefore forgeable — never a security control.
 */
function reportOutcome(
  source: AvatarPortraitSource,
  outcome: { ok: true } | { ok: false; error: string },
) {
  // Check-in transfers do not disclose their backing session ID to the client.
  if (!source.sessionId || isRoadTeacherMockEnabled()) return;
  void fetch(`${sourcePath(source)}/avatar-result`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(outcome),
  }).catch(() => {});
}

export async function replaceRoadTeacherAvatar(
  input: AvatarPortraitSource & {
    email: string;
    password: string;
  },
): Promise<AvatarReplaceResult> {
  const endpoint = roadTeacherEndpoint();
  if (!endpoint) {
    throw new Error("路老師系統尚未開通，請稍後再試。");
  }

  let authenticated = false;
  try {
    const idToken = await signInToRoadTeacher(input.email, input.password);
    authenticated = true;
    const portraitUrl = await mintPortraitUrl(input);
    // RT treats sessionId as correlation metadata, never as account identity.
    // Do not reveal the creation capability when the guest only has check-in access.
    const correlationId =
      input.sessionId ?? crypto.randomUUID().replaceAll("-", "");
    const response = await fetchForAvatar(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ portraitUrl, sessionId: correlationId }),
      credentials: "omit",
      redirect: "error",
    });
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      mock?: boolean;
      ok?: boolean;
    };
    if (
      !response.ok ||
      payload.ok !== true ||
      (payload.mock === true && !isRoadTeacherMockEnabled())
    ) {
      const messages: Record<number, string> = {
        400: "無法使用這張作品，請洽現場工作人員。",
        401: "登入憑證已失效，請重新登入再試。",
        403: "此帳號無法替換大頭貼，請聯絡路老師系統管理員。",
        413: "圖片大小不符合限制。",
        415: "不支援的圖片格式。",
        429: "嘗試次數過多，請稍後再試。",
      };
      throw new Error(messages[response.status] || "路老師系統暫時無法使用。");
    }

    reportOutcome(input, { ok: true });
    return { mock: payload.mock === true };
  } catch (error) {
    if (authenticated)
      reportOutcome(input, {
        ok: false,
        error: "用戶端回報替換未完成。",
      });
    throw error;
  } finally {
    // Booth handsets get passed around: the RT session must not outlive this.
    await forgetRoadTeacherSession().catch(() => {});
  }
}

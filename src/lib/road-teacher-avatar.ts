import { isImageTuningEnabled } from "@/lib/runtime-env";

/**
 * Server-to-server call to road-teacher's bloomSetAvatarByIdentity function
 * (road-teacher docs/BLOOM_IDENTITY_AVATAR.md). Sends the finished portrait
 * with the guest's 姓名 + 手機號碼; road-teacher writes it as the avatar of
 * the one teacher whose displayName and mobile both match.
 *
 * Only this server holds the key, so the browser never talks to road-teacher.
 */

export type AvatarResult = { mock: boolean };

/** Road-teacher error codes, mapped to what the guest should read. */
const GUEST_MESSAGES: Record<string, { status: number; message: string }> = {
  teacher_not_found: {
    status: 404,
    message: "找不到符合這組姓名與手機的路老師，請確認與路老師系統登記的資料相同。",
  },
  ambiguous_teacher: {
    status: 409,
    message: "有多位路老師符合這組姓名與手機，請洽現場工作人員協助。",
  },
  rate_limited: {
    status: 429,
    message: "這支手機號碼嘗試次數過多，請一小時後再試。",
  },
  account_disabled: {
    status: 403,
    message: "此路老師帳號目前停用，無法替換大頭貼。",
  },
};

export class RoadTeacherAvatarError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "RoadTeacherAvatarError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Dev/preview stand-in, enabled by NEXT_PUBLIC_RT_MOCK (already set in
 * .env.development.local). Never active in production builds, so a stray
 * flag cannot fake a success for a real guest.
 */
export function isRoadTeacherAvatarMockEnabled() {
  const flag = process.env.NEXT_PUBLIC_RT_MOCK?.trim().toLowerCase();
  return (flag === "1" || flag === "true") && isImageTuningEnabled();
}

export async function requestRoadTeacherAvatar(input: {
  sessionId: string;
  name: string;
  mobile: string;
  imageBytes: Buffer;
  imageMime: string;
}): Promise<AvatarResult> {
  if (isRoadTeacherAvatarMockEnabled()) {
    return { mock: true };
  }

  const endpoint = process.env.ROAD_TEACHER_AVATAR_API_URL?.trim();
  const apiKey = process.env.ROAD_TEACHER_AVATAR_API_KEY?.trim();
  if (!endpoint || !apiKey) {
    throw new RoadTeacherAvatarError(
      "路老師系統連線尚未設定，請洽現場工作人員。",
      503,
      "not_configured",
    );
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        mobile: input.mobile,
        sessionId: input.sessionId,
        image: input.imageBytes.toString("base64"),
        imageMime: input.imageMime,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    throw new RoadTeacherAvatarError(
      "路老師系統暫時無法連線，請稍後再試。",
      502,
      "unreachable",
    );
  }

  if (response.ok) return { mock: false };

  const payload = (await response.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
  };
  const known = payload.code ? GUEST_MESSAGES[payload.code] : undefined;
  if (known) {
    throw new RoadTeacherAvatarError(known.message, known.status, payload.code!);
  }

  // 401/400/415/5xx are integration faults, not something the guest can fix.
  console.error("road-teacher avatar request failed", {
    status: response.status,
    code: payload.code,
    error: payload.error,
  });
  throw new RoadTeacherAvatarError(
    "路老師系統暫時無法替換大頭貼，請稍後再試。",
    502,
    payload.code ?? `http_${response.status}`,
  );
}

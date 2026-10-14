import { AppError, ConfigError } from "@/lib/api-errors";
import { checkDeployEnvironment } from "@/lib/deploy-env";
import type { GuestIdentity } from "@/lib/guest-identity";

/**
 * Client for the road-teacher `bloomIdentityChallenge` function.
 *
 * RT owns the mapping from phone number to teacher name and never returns it:
 * it hands back a line-up of names plus a sealed `challengeId`, and verifies the
 * picked name itself. So this server can present the challenge without ever
 * being able to turn a phone number into a name.
 */

export type IdentityChallenge = {
  challengeId: string;
  options: string[];
  expiresAt: number;
};

export class IdentityServiceError extends AppError {
  constructor(message = "目前無法連線路老師系統，請稍後再試。") {
    super(message, 502, "IDENTITY_SERVICE_UNAVAILABLE");
    this.name = "IdentityServiceError";
  }
}

/**
 * The line-up went stale before the guest picked. Distinct from an outage: the
 * guest just needs a fresh challenge, and it costs them no attempt.
 */
export class ChallengeExpiredError extends AppError {
  constructor() {
    super("驗證已逾時，請重新驗證手機號碼。", 410, "IDENTITY_CHALLENGE_EXPIRED");
    this.name = "ChallengeExpiredError";
  }
}

function endpoint(path: string) {
  const base = process.env.ROAD_TEACHER_IDENTITY_API_URL?.trim();
  if (!base) {
    throw new ConfigError(
      "尚未設定 ROAD_TEACHER_IDENTITY_API_URL。",
      "IDENTITY_SERVICE_UNAVAILABLE",
    );
  }

  // The build guard should have caught this, but a deployment that slipped past
  // it must refuse the call rather than read another stage's teacher records.
  // Narrow on purpose: only this cross-stage call fails, not the whole app.
  const crossStage = checkDeployEnvironment().problems.find(
    (problem) => problem.variable === "ROAD_TEACHER_IDENTITY_API_URL",
  );
  if (crossStage) {
    console.error(
      `[rt-identity] refusing a cross-environment call: ${crossStage.detail}`,
    );
    throw new ConfigError(
      "系統環境設定有誤，暫時無法驗證手機號碼。",
      "ENVIRONMENT_MISCONFIGURED",
    );
  }

  return `${base.replace(/\/+$/, "")}/${path}`;
}

function authHeaders() {
  const key = process.env.ROAD_TEACHER_API_KEY?.trim();
  if (!key) {
    throw new ConfigError(
      "尚未設定 ROAD_TEACHER_API_KEY。",
      "IDENTITY_SERVICE_UNAVAILABLE",
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint(path), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (error) {
    console.error(`[rt-identity] ${path} request failed:`, error);
    throw new IdentityServiceError();
  }

  if (!response.ok) {
    // A stale challenge is the guest's to retry, not an outage to report.
    if (response.status === 410) throw new ChallengeExpiredError();

    console.error(`[rt-identity] ${path} responded ${response.status}`);
    throw new IdentityServiceError();
  }

  return (await response.json()) as T;
}

/**
 * Asks RT for a line-up. An unregistered number still returns a full option
 * list — the response shape cannot be used to enumerate who is registered — and
 * every option simply fails to verify.
 */
export async function requestIdentityChallenge(
  identity: GuestIdentity,
  optionCount?: number,
): Promise<IdentityChallenge> {
  const payload = await post<Partial<IdentityChallenge>>("challenge", {
    mobile: identity.value,
    ...(optionCount ? { optionCount } : {}),
  });

  if (
    typeof payload.challengeId !== "string" ||
    !Array.isArray(payload.options) ||
    payload.options.length < 2
  ) {
    throw new IdentityServiceError();
  }

  return {
    challengeId: payload.challengeId,
    options: payload.options.map(String),
    expiresAt:
      typeof payload.expiresAt === "number" ? payload.expiresAt : Date.now(),
  };
}

export type VerifyOutcome = {
  verified: boolean;
  /** Echoed from the sealed challenge, never from the request. */
  mobile: string;
};

export async function verifyIdentityAnswer(
  challengeId: string,
  answer: string,
): Promise<VerifyOutcome> {
  const payload = await post<Partial<VerifyOutcome>>("verify", {
    challengeId,
    answer,
  });

  return {
    verified: payload.verified === true,
    mobile: typeof payload.mobile === "string" ? payload.mobile : "",
  };
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postChallenge } from "@/app/api/identity/challenge/route";
import { POST as postVerify } from "@/app/api/identity/verify/route";
import { readIdentityToken } from "@/lib/identity-token";
import { MAX_ATTEMPTS } from "@/lib/identity-lockout";

const { challengeMock, verifyMock } = vi.hoisted(() => ({
  challengeMock: vi.fn(),
  verifyMock: vi.fn(),
}));

vi.mock("@/lib/road-teacher-identity", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/road-teacher-identity")
  >("@/lib/road-teacher-identity");
  return {
    ...actual,
    requestIdentityChallenge: challengeMock,
    verifyIdentityAnswer: verifyMock,
  };
});

const MOBILE = "0912345678";
const REAL_NAME = "王小明";
const OPTIONS = [REAL_NAME, "林大華", "陳怡君", "張家豪", "李淑芬"];

function jsonRequest(body: unknown) {
  return new Request("http://booth.local/api/identity", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function challenge(body: unknown) {
  return postChallenge(jsonRequest(body));
}

function verify(answer: string, mobile = MOBILE) {
  return postVerify(jsonRequest({ mobile, challengeId: "sealed", answer }));
}

beforeEach(() => {
  process.env.IDENTITY_KEY_SECRET = "test-identity-secret";
  challengeMock.mockReset();
  challengeMock.mockResolvedValue({
    challengeId: "sealed",
    options: OPTIONS,
    expiresAt: Date.now() + 300_000,
  });
  verifyMock.mockReset();
  verifyMock.mockImplementation(async (_id: string, answer: string) => ({
    verified: answer === REAL_NAME,
    mobile: MOBILE,
  }));
});

describe("POST /api/identity/challenge", () => {
  it("returns the name line-up for a valid number", async () => {
    const response = await challenge({ mobile: "0912-345-678" });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.options).toHaveLength(5);
    expect(payload.attemptsRemaining).toBe(MAX_ATTEMPTS);
    expect(challengeMock).toHaveBeenCalledWith({
      kind: "mobile",
      value: MOBILE,
    });
  });

  it("rejects a malformed number with an accurate code", async () => {
    const response = await challenge({ mobile: "張小明" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDENTITY_INVALID" });
    expect(challengeMock).not.toHaveBeenCalled();
  });

  it("surfaces a road-teacher outage as a 502 rather than a wrong answer", async () => {
    const { IdentityServiceError } = await vi.importActual<
      typeof import("@/lib/road-teacher-identity")
    >("@/lib/road-teacher-identity");
    challengeMock.mockRejectedValue(new IdentityServiceError());

    const response = await challenge({ mobile: MOBILE });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_SERVICE_UNAVAILABLE",
    });
  });
});

describe("POST /api/identity/verify", () => {
  it("issues a usable identity token for the right name", async () => {
    const response = await verify(REAL_NAME);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(readIdentityToken(payload.identityToken)).toEqual({
      kind: "mobile",
      value: MOBILE,
    });
  });

  it("never returns the number's real name on a wrong answer", async () => {
    const response = await verify("林大華");
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain(REAL_NAME);
    expect(JSON.parse(body)).toMatchObject({
      code: "IDENTITY_ANSWER_WRONG",
      attemptsRemaining: MAX_ATTEMPTS - 1,
    });
  });

  it("counts down and locks on the fifth wrong answer", async () => {
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      const payload = await (await verify("林大華")).json();
      expect(payload.attemptsRemaining).toBe(MAX_ATTEMPTS - i);
    }

    const fifth = await verify("林大華");
    expect(fifth.status).toBe(400);
    expect(await fifth.json()).toMatchObject({ attemptsRemaining: 0 });

    // Sixth attempt is refused outright, and the right answer no longer helps.
    const locked = await verify(REAL_NAME);
    expect(locked.status).toBe(423);
    expect(await locked.json()).toMatchObject({ code: "IDENTITY_LOCKED" });
  });

  it("does not grade an answer while locked", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await verify("林大華");
    verifyMock.mockClear();

    await verify(REAL_NAME);

    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("locks one number without touching another", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) await verify("林大華");

    verifyMock.mockResolvedValue({ verified: true, mobile: "0987654321" });
    const other = await verify(REAL_NAME, "0987654321");

    expect(other.status).toBe(200);
  });

  // A correct answer for one number must not mint a token for another.
  it("refuses a verification whose sealed number does not match", async () => {
    verifyMock.mockResolvedValue({ verified: true, mobile: "0987654321" });

    const response = await verify(REAL_NAME);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_ANSWER_WRONG",
    });
  });

  it("clears the count after a correct answer", async () => {
    await verify("林大華");
    await verify("林大華");
    await verify(REAL_NAME);

    const payload = await (await verify("林大華")).json();
    expect(payload.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
  });

  it("reports a stale line-up as expired, without spending an attempt", async () => {
    const { ChallengeExpiredError } = await vi.importActual<
      typeof import("@/lib/road-teacher-identity")
    >("@/lib/road-teacher-identity");
    verifyMock.mockRejectedValue(new ChallengeExpiredError());

    const response = await verify(REAL_NAME);

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_CHALLENGE_EXPIRED",
    });

    // The guest still has every attempt: they never gave a wrong answer.
    verifyMock.mockImplementation(async (_id: string, answer: string) => ({
      verified: answer === REAL_NAME,
      mobile: MOBILE,
    }));
    const next = await (await verify("林大華")).json();
    expect(next.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
  });

  it("requires both a challenge and an answer", async () => {
    const response = await postVerify(jsonRequest({ mobile: MOBILE }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IDENTITY_REQUIRED" });
  });
});

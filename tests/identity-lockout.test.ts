import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTEMPT_WINDOW_MS,
  assertNotLocked,
  clearAttempts,
  LOCK_DURATION_MS,
  MAX_ATTEMPTS,
  readLockout,
  recordFailedAttempt,
} from "@/lib/identity-lockout";

const KEY = "mobile_test-key";

async function failTimes(count: number, now = Date.now()) {
  let last;
  for (let i = 0; i < count; i += 1) {
    last = await recordFailedAttempt(KEY, now);
  }
  return last!;
}

beforeEach(() => {
  process.env.IDENTITY_KEY_SECRET = "test-identity-secret";
});

describe("identity lockout", () => {
  it("starts with the full allowance", async () => {
    await expect(readLockout(KEY)).resolves.toEqual({
      locked: false,
      retryAfterSeconds: 0,
      attemptsRemaining: MAX_ATTEMPTS,
    });
  });

  it("counts down one attempt per wrong answer", async () => {
    const now = Date.now();

    expect((await recordFailedAttempt(KEY, now)).attemptsRemaining).toBe(4);
    expect((await recordFailedAttempt(KEY, now)).attemptsRemaining).toBe(3);
    expect((await recordFailedAttempt(KEY, now)).attemptsRemaining).toBe(2);
    expect((await recordFailedAttempt(KEY, now)).locked).toBe(false);
  });

  it("locks for 30 minutes on the fifth wrong answer", async () => {
    const now = Date.now();
    const state = await failTimes(MAX_ATTEMPTS, now);

    expect(state.locked).toBe(true);
    expect(state.attemptsRemaining).toBe(0);
    expect(state.retryAfterSeconds).toBe(LOCK_DURATION_MS / 1000);
  });

  it("refuses further attempts while locked", async () => {
    const now = Date.now();
    await failTimes(MAX_ATTEMPTS, now);

    await expect(assertNotLocked(KEY, now)).rejects.toMatchObject({
      status: 423,
      code: "IDENTITY_LOCKED",
    });
    // Still locked one second before the window closes.
    await expect(
      assertNotLocked(KEY, now + LOCK_DURATION_MS - 1000),
    ).rejects.toMatchObject({ code: "IDENTITY_LOCKED" });
  });

  it("lifts the lock once 30 minutes have passed", async () => {
    const now = Date.now();
    await failTimes(MAX_ATTEMPTS, now);

    const after = await readLockout(KEY, now + LOCK_DURATION_MS + 1);
    expect(after).toMatchObject({
      locked: false,
      attemptsRemaining: MAX_ATTEMPTS,
    });
    await expect(
      assertNotLocked(KEY, now + LOCK_DURATION_MS + 1),
    ).resolves.toBeDefined();
  });

  // An honest guest who mistypes once today must not accrue toward a lock weeks later.
  it("forgets stale attempts outside the window", async () => {
    const now = Date.now();
    await failTimes(4, now);

    const later = await recordFailedAttempt(KEY, now + ATTEMPT_WINDOW_MS + 1);
    expect(later.locked).toBe(false);
    expect(later.attemptsRemaining).toBe(MAX_ATTEMPTS - 1);
  });

  it("clears the slate on a correct answer", async () => {
    const now = Date.now();
    await failTimes(4, now);
    await clearAttempts(KEY);

    await expect(readLockout(KEY, now)).resolves.toMatchObject({
      attemptsRemaining: MAX_ATTEMPTS,
      locked: false,
    });
  });

  it("keeps separate counts per phone number", async () => {
    const now = Date.now();
    await failTimes(MAX_ATTEMPTS, now);

    await expect(
      readLockout("mobile_someone-else", now),
    ).resolves.toMatchObject({ locked: false });
  });
});

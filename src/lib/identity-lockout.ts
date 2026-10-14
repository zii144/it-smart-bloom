import { getDb, isFirebaseConfigured } from "@/lib/firebase-admin";
import { AppError } from "@/lib/api-errors";
import { identityStorageKey, type GuestIdentity } from "@/lib/guest-identity";

/**
 * Attempt limiting for the booth identity challenge.
 *
 * Five wrong answers lock that phone number out for thirty minutes. State lives
 * in Firestore so the limit holds across serverless isolates, keyed by the HMAC
 * of the number rather than the number itself — a lockout document is not a
 * list of phone numbers.
 */

export const MAX_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 30 * 60 * 1000;
/** Failures older than this no longer count, so an honest guest never accrues. */
export const ATTEMPT_WINDOW_MS = 30 * 60 * 1000;

const COLLECTION = "identityLockouts";

type LockoutRecord = {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number;
};

export type LockoutState = {
  locked: boolean;
  /** Seconds until the lock lifts; 0 when not locked. */
  retryAfterSeconds: number;
  attemptsRemaining: number;
};

/**
 * Per-isolate fallback for local development and tests, where Firebase is not
 * configured. It is NOT a security boundary — a multi-isolate deployment
 * without Firestore would count attempts per instance.
 */
const fallback = new Map<string, LockoutRecord>();

export class IdentityLockedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super(
      `嘗試次數過多，請於 ${Math.ceil(retryAfterSeconds / 60)} 分鐘後再試。`,
      423,
      "IDENTITY_LOCKED",
    );
    this.name = "IdentityLockedError";
  }
}

function unlocked(): LockoutState {
  return { locked: false, retryAfterSeconds: 0, attemptsRemaining: MAX_ATTEMPTS };
}

function toState(record: LockoutRecord | undefined, now: number): LockoutState {
  if (!record) return unlocked();

  if (record.lockedUntil > now) {
    return {
      locked: true,
      retryAfterSeconds: Math.ceil((record.lockedUntil - now) / 1000),
      attemptsRemaining: 0,
    };
  }

  // A stale window counts as a clean slate.
  if (now - record.firstAttemptAt > ATTEMPT_WINDOW_MS) return unlocked();

  return {
    locked: false,
    retryAfterSeconds: 0,
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - record.attempts),
  };
}

function lockoutDoc(key: string) {
  const db = getDb();
  if (!db) return null;
  return db.collection(COLLECTION).doc(key);
}

export function lockoutKey(identity: GuestIdentity) {
  return identityStorageKey(identity);
}

export async function readLockout(
  key: string,
  now = Date.now(),
): Promise<LockoutState> {
  const doc = lockoutDoc(key);
  if (!doc) return toState(fallback.get(key), now);

  try {
    const snap = await doc.get();
    return toState(snap.data() as LockoutRecord | undefined, now);
  } catch (error) {
    console.error("[lockout] could not read attempt state:", error);
    // Fail closed would strand every guest on a Firestore blip; fail open here
    // and let the write path, which is the one that matters, do the counting.
    return unlocked();
  }
}

export async function assertNotLocked(key: string, now = Date.now()) {
  const state = await readLockout(key, now);
  if (state.locked) throw new IdentityLockedError(state.retryAfterSeconds);
  return state;
}

/**
 * Counts one wrong answer and returns the state that follows it. Read and write
 * happen inside a Firestore transaction, so two attempts racing each other are
 * both counted instead of one overwriting the other.
 */
export async function recordFailedAttempt(
  key: string,
  now = Date.now(),
): Promise<LockoutState> {
  const next = (current: LockoutRecord | undefined): LockoutRecord => {
    const fresh =
      !current || now - current.firstAttemptAt > ATTEMPT_WINDOW_MS
        ? { attempts: 0, firstAttemptAt: now, lockedUntil: 0 }
        : current;

    const attempts = fresh.attempts + 1;
    return attempts >= MAX_ATTEMPTS
      ? { attempts, firstAttemptAt: fresh.firstAttemptAt, lockedUntil: now + LOCK_DURATION_MS }
      : { attempts, firstAttemptAt: fresh.firstAttemptAt, lockedUntil: 0 };
  };

  const db = getDb();
  const doc = lockoutDoc(key);

  if (!db || !doc) {
    const record = next(fallback.get(key));
    fallback.set(key, record);
    return toState(record, now);
  }

  try {
    const record = await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(doc);
      const updated = next(snap.data() as LockoutRecord | undefined);
      transaction.set(doc, { ...updated, updatedAt: new Date(now).toISOString() });
      return updated;
    });
    return toState(record, now);
  } catch (error) {
    console.error("[lockout] could not record a failed attempt:", error);
    // Counting is the security-relevant half, so a failure here locks rather
    // than silently granting unlimited guesses.
    throw new IdentityLockedError(Math.ceil(LOCK_DURATION_MS / 1000));
  }
}

/** A correct answer clears the slate. */
export async function clearAttempts(key: string) {
  fallback.delete(key);

  const doc = lockoutDoc(key);
  if (!doc) return;

  try {
    await doc.delete();
  } catch (error) {
    console.error("[lockout] could not clear attempt state:", error);
  }
}

/** Test seam: drops the per-isolate fallback between cases. */
export function resetLockoutCache() {
  fallback.clear();
}

export function lockoutStoreIsShared() {
  return isFirebaseConfigured();
}

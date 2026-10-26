import { rosterNameKey } from "@/lib/roster";

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
/** Wrong phone numbers tried for one name from one client. */
const MAX_FAILURES_PER_NAME = 8;
/**
 * Every guest at the event shares the booth's network address, so the
 * per-client ceiling must stay far above what a queue of typos can reach.
 */
const MAX_FAILURES_PER_CLIENT = 200;

/**
 * Per-instance only (serverless isolates do not share memory), so this slows
 * down guessing rather than stopping a determined attacker — which is fine:
 * a match needs both the right name and the right mobile.
 */
const failures = new Map<string, number[]>();

export function rosterClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

function recentFailures(key: string, now: number) {
  const recent = (failures.get(key) ?? []).filter(
    (at) => now - at < ATTEMPT_WINDOW_MS,
  );
  if (recent.length) failures.set(key, recent);
  else failures.delete(key);
  return recent;
}

function nameBucket(client: string, name: string) {
  return `${client}|${rosterNameKey(name)}`;
}

export function isRosterGuessBlocked(
  client: string,
  name: string,
  now = Date.now(),
) {
  return (
    recentFailures(nameBucket(client, name), now).length >= MAX_FAILURES_PER_NAME ||
    recentFailures(client, now).length >= MAX_FAILURES_PER_CLIENT
  );
}

export function recordRosterFailure(client: string, name: string, now = Date.now()) {
  for (const key of [nameBucket(client, name), client]) {
    failures.set(key, [...recentFailures(key, now), now]);
  }
}

export function resetGuestRosterAttempts() {
  failures.clear();
}

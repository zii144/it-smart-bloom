/**
 * Daily spend ceiling for OpenAI image generation.
 *
 * Every brake in the batch panel (50 per batch, no auto-start, concurrency)
 * lives in the browser and disappears the moment someone drives the API
 * directly. This module is the server-side one: a per-day counter in
 * Firestore that the generation path checks before it calls OpenAI.
 *
 * Reads go through a short-lived in-process cache so a 50-photo batch does
 * not mean 50 Firestore reads. The cache is bypassed once usage approaches
 * the ceiling, where being a few renders stale is the difference between
 * enforcing the limit and blowing past it.
 */

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import type { ImageGenerationOptions, ImageQuality } from "@/lib/image-options";

const USAGE_COLLECTION = "usage";
const CACHE_TTL_MS = 30_000;
/** Past this share of the ceiling, always read through to Firestore. */
const TIGHTEN_AT = 0.9;
/** The booth runs on Taiwan time; "today" must roll over at local midnight. */
const SPEND_TIMEZONE = "Asia/Taipei";

export type SpendScope = "booth" | "batch";

export type SpendLimits = {
  dailyLimit: number | null;
  dailyBudgetUsd: number | null;
  /** `batch` (default) spares walk-up guests; `all` also gates the booth. */
  enforce: SpendScope | "all";
  unitCostConfigured: boolean;
};

export type SpendUsage = {
  date: string;
  count: number;
  costUsd: number;
};

export type SpendSnapshot = SpendUsage & { limits: SpendLimits };

export class SpendLimitError extends Error {
  readonly status = 429;

  constructor(message: string) {
    super(message);
    this.name = "SpendLimitError";
  }
}

function positiveNumber(raw: string | undefined) {
  const value = Number(raw?.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseUnitCost(): number | Partial<Record<ImageQuality | "default", number>> | null {
  const raw = process.env.IMAGE_UNIT_COST_USD?.trim();
  if (!raw) return null;

  const flat = Number(raw);
  if (Number.isFinite(flat) && flat >= 0) return flat;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const table: Partial<Record<string, number>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const price = Number(value);
      if (Number.isFinite(price) && price >= 0) table[key] = price;
    }
    return Object.keys(table).length ? table : null;
  } catch {
    console.warn("[spend] IMAGE_UNIT_COST_USD is not a number or JSON object");
    return null;
  }
}

/**
 * Rough per-image cost, from operator-supplied prices — this project has no
 * business guessing OpenAI's rate card. Keyed by quality, which dominates
 * image pricing; size still moves the real number, so treat it as an estimate.
 */
export function unitCostUsd(options?: ImageGenerationOptions | null) {
  const configured = parseUnitCost();
  if (configured === null) return null;
  if (typeof configured === "number") return configured;

  const quality = options?.quality;
  const byQuality = quality ? configured[quality] : undefined;
  return byQuality ?? configured.default ?? null;
}

export function spendLimits(): SpendLimits {
  const enforceRaw = process.env.IMAGE_SPEND_ENFORCE?.trim().toLowerCase();
  return {
    dailyLimit: positiveNumber(process.env.IMAGE_DAILY_LIMIT),
    dailyBudgetUsd: positiveNumber(process.env.IMAGE_DAILY_BUDGET_USD),
    enforce: enforceRaw === "all" ? "all" : "batch",
    unitCostConfigured: parseUnitCost() !== null,
  };
}

export function spendDateKey(now = new Date()) {
  // en-CA formats as YYYY-MM-DD, which also sorts correctly as a doc id.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SPEND_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Survives when Firebase is unconfigured (local dev) so the cap still bites. */
const fallbackUsage = new Map<string, { count: number; costUsd: number }>();
let cache: (SpendUsage & { fetchedAt: number }) | null = null;

/** Tests and ops scripts need a way to drop the cached counter. */
export function resetSpendCache() {
  cache = null;
  fallbackUsage.clear();
}

function usageDoc(date: string) {
  return getDb()?.collection(USAGE_COLLECTION).doc(date) ?? null;
}

async function fetchUsage(date: string): Promise<SpendUsage> {
  const doc = usageDoc(date);
  if (!doc) {
    const local = fallbackUsage.get(date);
    return { date, count: local?.count ?? 0, costUsd: local?.costUsd ?? 0 };
  }

  try {
    const snap = await doc.get();
    const data = snap.data() as { count?: number; costUsd?: number } | undefined;
    return {
      date,
      count: Number(data?.count) || 0,
      costUsd: Number(data?.costUsd) || 0,
    };
  } catch (error) {
    // A Firestore outage must not become an unmetered spend window: fall back
    // to whatever this instance has counted itself.
    console.error("[spend] could not read today's usage:", error);
    const local = fallbackUsage.get(date);
    return { date, count: local?.count ?? 0, costUsd: local?.costUsd ?? 0 };
  }
}

function nearCeiling(usage: SpendUsage, limits: SpendLimits) {
  const byCount = limits.dailyLimit
    ? usage.count / limits.dailyLimit
    : 0;
  const byBudget = limits.dailyBudgetUsd
    ? usage.costUsd / limits.dailyBudgetUsd
    : 0;
  return Math.max(byCount, byBudget) >= TIGHTEN_AT;
}

export async function readSpendUsage(now = new Date()): Promise<SpendUsage> {
  const date = spendDateKey(now);
  const limits = spendLimits();

  if (
    cache &&
    cache.date === date &&
    now.getTime() - cache.fetchedAt < CACHE_TTL_MS &&
    !nearCeiling(cache, limits)
  ) {
    return { date: cache.date, count: cache.count, costUsd: cache.costUsd };
  }

  const usage = await fetchUsage(date);
  cache = { ...usage, fetchedAt: now.getTime() };
  return usage;
}

export async function readSpendSnapshot(now = new Date()): Promise<SpendSnapshot> {
  const usage = await readSpendUsage(now);
  return { ...usage, limits: spendLimits() };
}

function shouldEnforceSpend(scope: SpendScope, limits: SpendLimits) {
  if (!limits.dailyLimit && !limits.dailyBudgetUsd) return false;
  if (limits.enforce !== "all" && scope !== "batch") return false;
  return true;
}

function assertWithinCeiling(usage: SpendUsage, limits: SpendLimits) {
  if (limits.dailyLimit && usage.count >= limits.dailyLimit) {
    throw new SpendLimitError(
      `今日生成已達上限（${limits.dailyLimit} 張），請調整 IMAGE_DAILY_LIMIT 或明天再試。`,
    );
  }

  if (limits.dailyBudgetUsd && usage.costUsd >= limits.dailyBudgetUsd) {
    throw new SpendLimitError(
      `今日估算花費已達上限（US$${limits.dailyBudgetUsd}），請調整 IMAGE_DAILY_BUDGET_USD 或明天再試。`,
    );
  }
}

function rememberLocalSpend(
  date: string,
  cost: number,
  now: Date,
  next: { count: number; costUsd: number },
) {
  fallbackUsage.set(date, { count: next.count, costUsd: next.costUsd });
  cache = {
    date,
    count: next.count,
    costUsd: next.costUsd,
    fetchedAt: now.getTime(),
  };
}

/**
 * Throws when today's ceiling is already reached. Read-only preflight for the
 * batch panel; generation itself uses `reserveSpend` so check + count are one
 * atomic step when Firestore is available.
 */
export async function assertSpendAllowed(
  scope: SpendScope,
  now = new Date(),
): Promise<void> {
  const limits = spendLimits();
  if (!shouldEnforceSpend(scope, limits)) return;
  assertWithinCeiling(await readSpendUsage(now), limits);
}

/**
 * Atomically reserves one billable render against today's ceiling, then
 * records it. Prefer this over assert + record on the OpenAI path.
 */
export async function reserveSpend(
  scope: SpendScope,
  options?: ImageGenerationOptions | null,
  now = new Date(),
): Promise<SpendUsage> {
  const limits = spendLimits();
  const enforce = shouldEnforceSpend(scope, limits);
  const date = spendDateKey(now);
  const cost = unitCostUsd(options) ?? 0;
  const doc = usageDoc(date);

  if (doc) {
    try {
      const reserved = await doc.firestore.runTransaction(async (tx) => {
        const snap = await tx.get(doc);
        const data = snap.data() as
          | { count?: number; costUsd?: number }
          | undefined;
        const current = {
          count: Number(data?.count) || 0,
          costUsd: Number(data?.costUsd) || 0,
        };
        if (enforce) assertWithinCeiling({ date, ...current }, limits);

        const next = {
          count: current.count + 1,
          costUsd: current.costUsd + cost,
        };
        tx.set(
          doc,
          {
            date,
            count: next.count,
            costUsd: next.costUsd,
            updatedAt: now.toISOString(),
          },
          { merge: true },
        );
        return next;
      });

      rememberLocalSpend(date, cost, now, reserved);
      return { date, count: reserved.count, costUsd: reserved.costUsd };
    } catch (error) {
      if (error instanceof SpendLimitError) throw error;
      console.error("[spend] transactional reserve failed:", error);
      // Fall through to the in-process counter so a Firestore blip does not
      // open an unmetered window on this isolate.
    }
  }

  const local = fallbackUsage.get(date) ?? { count: 0, costUsd: 0 };
  if (enforce) assertWithinCeiling({ date, ...local }, limits);
  const next = { count: local.count + 1, costUsd: local.costUsd + cost };
  rememberLocalSpend(date, cost, now, next);
  return { date, count: next.count, costUsd: next.costUsd };
}

/**
 * Counts one billable render without applying the ceiling. Prefer
 * `reserveSpend` on generation paths that must enforce the daily limit.
 */
export async function recordSpend(
  options?: ImageGenerationOptions | null,
  now = new Date(),
): Promise<SpendUsage> {
  const date = spendDateKey(now);
  const cost = unitCostUsd(options) ?? 0;
  const doc = usageDoc(date);

  if (doc) {
    try {
      await doc.set(
        {
          date,
          count: FieldValue.increment(1),
          costUsd: FieldValue.increment(cost),
          updatedAt: now.toISOString(),
        },
        { merge: true },
      );
    } catch (error) {
      console.error("[spend] could not record usage:", error);
    }
  }

  const local = fallbackUsage.get(date) ?? { count: 0, costUsd: 0 };
  const next = { count: local.count + 1, costUsd: local.costUsd + cost };
  rememberLocalSpend(date, cost, now, next);
  return { date, count: next.count, costUsd: next.costUsd };
}

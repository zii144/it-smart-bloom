import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultImageOptions } from "@/lib/image-options";
import {
  assertSpendAllowed,
  readSpendUsage,
  recordSpend,
  resetSpendCache,
  spendDateKey,
  spendLimits,
  SpendLimitError,
  unitCostUsd,
} from "@/lib/image-spend";

const SPEND_ENV = [
  "IMAGE_DAILY_LIMIT",
  "IMAGE_DAILY_BUDGET_USD",
  "IMAGE_UNIT_COST_USD",
  "IMAGE_SPEND_ENFORCE",
];

beforeEach(() => {
  for (const key of SPEND_ENV) delete process.env[key];
  resetSpendCache();
});

/** No Firebase in unit tests: the module falls back to its in-process counter. */
async function spend(times: number, quality?: "low" | "medium" | "high") {
  const options = { ...defaultImageOptions(), ...(quality ? { quality } : {}) };
  for (let i = 0; i < times; i += 1) {
    await recordSpend(options);
  }
}

describe("spendLimits", () => {
  it("treats unset, zero and junk ceilings as no limit", async () => {
    expect(spendLimits().dailyLimit).toBeNull();

    for (const value of ["0", "-5", "abc", ""]) {
      process.env.IMAGE_DAILY_LIMIT = value;
      expect(spendLimits().dailyLimit).toBeNull();
    }
  });

  it("defaults to sparing the booth and only gating batch", () => {
    expect(spendLimits().enforce).toBe("batch");

    process.env.IMAGE_SPEND_ENFORCE = "all";
    expect(spendLimits().enforce).toBe("all");

    process.env.IMAGE_SPEND_ENFORCE = "nonsense";
    expect(spendLimits().enforce).toBe("batch");
  });
});

describe("unitCostUsd", () => {
  it("has no opinion until an operator supplies prices", () => {
    expect(unitCostUsd(defaultImageOptions())).toBeNull();
    expect(spendLimits().unitCostConfigured).toBe(false);
  });

  it("accepts a flat per-image price", () => {
    process.env.IMAGE_UNIT_COST_USD = "0.25";
    expect(unitCostUsd(defaultImageOptions())).toBe(0.25);
    expect(spendLimits().unitCostConfigured).toBe(true);
  });

  it("accepts a table keyed by quality, with a default fallback", () => {
    process.env.IMAGE_UNIT_COST_USD = JSON.stringify({
      low: 0.02,
      high: 0.4,
      default: 0.1,
    });

    const options = defaultImageOptions();
    expect(unitCostUsd({ ...options, quality: "low" })).toBe(0.02);
    expect(unitCostUsd({ ...options, quality: "high" })).toBe(0.4);
    // `medium` is absent from the table, so the default price applies.
    expect(unitCostUsd({ ...options, quality: "medium" })).toBe(0.1);
  });

  it("ignores malformed config rather than guessing a price", () => {
    process.env.IMAGE_UNIT_COST_USD = "{not json";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(unitCostUsd(defaultImageOptions())).toBeNull();
    warn.mockRestore();
  });
});

describe("recordSpend", () => {
  it("counts every attempt and accumulates the estimated cost", async () => {
    process.env.IMAGE_UNIT_COST_USD = "0.5";

    await spend(3);

    const usage = await readSpendUsage();
    expect(usage.count).toBe(3);
    expect(usage.costUsd).toBeCloseTo(1.5);
    expect(usage.date).toBe(spendDateKey());
  });

  it("counts renders with no configured price without inventing cost", async () => {
    await spend(2);

    const usage = await readSpendUsage();
    expect(usage.count).toBe(2);
    expect(usage.costUsd).toBe(0);
  });

  it("keeps each day on its own counter", async () => {
    const monday = new Date("2026-08-03T04:00:00Z");
    const tuesday = new Date("2026-08-04T04:00:00Z");

    await recordSpend(defaultImageOptions(), monday);
    await recordSpend(defaultImageOptions(), tuesday);

    expect((await readSpendUsage(tuesday)).count).toBe(1);
  });
});

describe("assertSpendAllowed", () => {
  it("allows everything when no ceiling is configured", async () => {
    await spend(500);
    await expect(assertSpendAllowed("batch")).resolves.toBeUndefined();
  });

  it("refuses batch renders once the daily count is reached", async () => {
    process.env.IMAGE_DAILY_LIMIT = "3";

    await spend(2);
    await expect(assertSpendAllowed("batch")).resolves.toBeUndefined();

    await spend(1);
    await expect(assertSpendAllowed("batch")).rejects.toBeInstanceOf(
      SpendLimitError,
    );
  });

  it("refuses once the estimated budget is reached", async () => {
    process.env.IMAGE_UNIT_COST_USD = "2";
    process.env.IMAGE_DAILY_BUDGET_USD = "5";

    await spend(2);
    await expect(assertSpendAllowed("batch")).resolves.toBeUndefined();

    await spend(1); // 6 > 5
    await expect(assertSpendAllowed("batch")).rejects.toThrow(/US\$5/);
  });

  it("spares walk-up guests by default but still gates the batch tool", async () => {
    process.env.IMAGE_DAILY_LIMIT = "1";
    await spend(1);

    await expect(assertSpendAllowed("booth")).resolves.toBeUndefined();
    await expect(assertSpendAllowed("batch")).rejects.toBeInstanceOf(
      SpendLimitError,
    );
  });

  it("gates the booth too when enforcement is set to all", async () => {
    process.env.IMAGE_DAILY_LIMIT = "1";
    process.env.IMAGE_SPEND_ENFORCE = "all";
    await spend(1);

    await expect(assertSpendAllowed("booth")).rejects.toBeInstanceOf(
      SpendLimitError,
    );
  });

  it("carries a Chinese message naming the env var to raise", async () => {
    process.env.IMAGE_DAILY_LIMIT = "1";
    await spend(1);

    await expect(assertSpendAllowed("batch")).rejects.toThrow(
      /IMAGE_DAILY_LIMIT/,
    );
  });

  it("resets the next day", async () => {
    process.env.IMAGE_DAILY_LIMIT = "1";
    const today = new Date("2026-08-03T04:00:00Z");
    const tomorrow = new Date("2026-08-04T04:00:00Z");

    await recordSpend(defaultImageOptions(), today);
    await expect(assertSpendAllowed("batch", today)).rejects.toBeInstanceOf(
      SpendLimitError,
    );
    await expect(
      assertSpendAllowed("batch", tomorrow),
    ).resolves.toBeUndefined();
  });
});

describe("spendDateKey", () => {
  it("rolls over at Taiwan midnight, not UTC", () => {
    // 2026-08-03T16:30Z is already 2026-08-04 in Taipei (UTC+8).
    expect(spendDateKey(new Date("2026-08-03T16:30:00Z"))).toBe("2026-08-04");
    expect(spendDateKey(new Date("2026-08-03T15:30:00Z"))).toBe("2026-08-03");
  });
});

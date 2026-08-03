import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { resetSpendCache } from "@/lib/image-spend";

/**
 * Env that changes how sessions/generation behave. Cleared before every test so
 * a developer's real `.env.local` can never leak in and flip an assertion.
 */
const VOLATILE_ENV_KEYS = [
  "NEXT_PUBLIC_IMAGE_TUNING",
  "VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_ENV",
  "OPENAI_IMAGE_MODEL",
  "OPENAI_IMAGE_QUALITY",
  "OPENAI_IMAGE_SIZE",
  "APP_BASE_URL",
  "FAKE_GENERATE_DELAY_MS",
  "FAKE_GENERATE_MODE",
  "ADMIN_DASHBOARD_SECRET",
  "NEXT_PUBLIC_RT_MOCK",
  "NEXT_PUBLIC_RT_MOCK_DELAY_MS",
  "NEXT_PUBLIC_RT_SET_AVATAR_URL",
  "IMAGE_DAILY_LIMIT",
  "IMAGE_DAILY_BUDGET_USD",
  "IMAGE_UNIT_COST_USD",
  "IMAGE_SPEND_ENFORCE",
];

let dataDir: string;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "bloom-test-"));
  process.env.BLOOM_DATA_DIR = dataDir;
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const key of VOLATILE_ENV_KEYS) {
    delete process.env[key];
  }
  process.env.OPENAI_API_KEY = "test-api-key";
  process.env.OPENAI_IMAGE_SYSTEM_PROMPT = "test system prompt";
  // Keep fake-generate unit tests fast unless a case opts into a delay.
  process.env.FAKE_GENERATE_DELAY_MS = "0";
  // Same for the road-teacher mock sign-in.
  process.env.NEXT_PUBLIC_RT_MOCK_DELAY_MS = "0";
  // Renders counted by one test must not push the next one over a ceiling.
  resetSpendCache();
});

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import {
  mimeForOutputFormat,
  resolveImageOptions,
  type ImageGenerationOverrides,
} from "@/lib/image-options";
import { reserveSpend } from "@/lib/image-spend";
import { archiveSessionStatus } from "@/lib/portrait-archive";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import {
  assertSessionNotExpired,
  getSession,
  isGenerationLeaseActive,
  maxGenerationsFor,
  readInputImage,
  SessionError,
  updateSession,
  writeResultImage,
  type ImageSession,
} from "@/lib/sessions";

const activeGenerations = new Map<string, Promise<void>>();
const DEFAULT_FAKE_DELAY_MS = 1200;
const FAKE_PORTRAIT_FIXTURE = path.join(
  process.cwd(),
  "fixtures",
  "fake-portrait.jpg",
);

function openaiCredentials() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const prompt = process.env.OPENAI_IMAGE_SYSTEM_PROMPT?.trim();

  if (!apiKey) {
    throw new Error("尚未設定 OPENAI_API_KEY。");
  }

  if (!prompt) {
    throw new Error("尚未設定 OPENAI_IMAGE_SYSTEM_PROMPT。");
  }

  return { apiKey, prompt };
}

/** Demo delay before writing the fake result. Tests set FAKE_GENERATE_DELAY_MS=0. */
export function fakeGenerateDelayMs() {
  const raw = process.env.FAKE_GENERATE_DELAY_MS?.trim();
  if (raw === undefined || raw === "") {
    return DEFAULT_FAKE_DELAY_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_FAKE_DELAY_MS;
  }
  return parsed;
}

/**
 * `fixture` (default): ship a canned watercolor so demos look finished.
 * `echo`: copy the booth capture — useful for plumbing / byte-identity checks.
 */
export function fakeGenerateMode(): "fixture" | "echo" {
  const mode = process.env.FAKE_GENERATE_MODE?.trim().toLowerCase();
  return mode === "echo" ? "echo" : "fixture";
}

async function loadFakeResult(id: string) {
  if (fakeGenerateMode() === "echo") {
    return readInputImage(id);
  }

  if (!existsSync(FAKE_PORTRAIT_FIXTURE)) {
    console.warn(
      `[fake-generate] missing ${FAKE_PORTRAIT_FIXTURE}; falling back to echo`,
    );
    return readInputImage(id);
  }

  return {
    bytes: await readFile(FAKE_PORTRAIT_FIXTURE),
    mime: "image/jpeg" as const,
  };
}

async function markGenerating(id: string, incrementAttempts: boolean) {
  const session = await getSession(id);
  const nextAttempts = incrementAttempts
    ? (session.generationAttempts ?? 0) + 1
    : (session.generationAttempts ?? 0);
  const updated = await updateSession(id, {
    status: "generating",
    error: undefined,
    generationStartedAt: new Date().toISOString(),
    generationAttempts: nextAttempts,
  });
  await archiveSessionStatus(updated).catch((error) => {
    console.error(`Failed to archive generating status for ${id}:`, error);
  });
  return updated;
}

async function markFailed(id: string, error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unknown generation error";
  console.error(`Image generation failed for ${id}:`, error);
  const failed = await updateSession(id, { status: "failed", error: message });
  await archiveSessionStatus(failed).catch((archiveError) => {
    console.error(`Failed to archive failure for ${id}:`, archiveError);
  });
}

async function runFakeGeneration(id: string) {
  const delayMs = fakeGenerateDelayMs();
  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const result = await loadFakeResult(id);
  const finished = await writeResultImage(id, result.bytes, result.mime);
  await archiveSessionStatus(finished, {
    bytes: result.bytes,
    mime: result.mime,
  }).catch((error) => {
    console.error(`Failed to archive fake result for ${id}:`, error);
  });
}

async function runOpenAiGeneration(
  id: string,
  settings: ReturnType<typeof resolveImageOptions>,
) {
  const credentials = openaiCredentials();
  const input = await readInputImage(id);
  const client = new OpenAI({ apiKey: credentials.apiKey });
  const extension =
    input.mime === "image/png"
      ? "png"
      : input.mime === "image/webp"
        ? "webp"
        : "jpg";

  const response = await client.images.edit({
    model: settings.model,
    image: await toFile(input.bytes, `portrait.${extension}`, {
      type: input.mime,
    }),
    prompt: credentials.prompt,
    quality: settings.quality,
    size: settings.size,
    output_format: settings.outputFormat,
    output_compression:
      settings.outputFormat === "png" ? undefined : settings.outputCompression,
    n: 1,
  });

  const encoded = response.data?.[0]?.b64_json;
  if (!encoded) {
    throw new Error("OpenAI 未回傳圖片資料。");
  }

  const bytes = Buffer.from(encoded, "base64");
  const mime = mimeForOutputFormat(settings.outputFormat);
  const finished = await writeResultImage(id, bytes, mime);
  await archiveSessionStatus(finished, { bytes, mime }).catch((error) => {
    console.error(`Failed to archive result for ${id}:`, error);
  });
}

function assertGenerationBudget(session: ImageSession) {
  const attempts = session.generationAttempts ?? 0;
  const limit = maxGenerationsFor(session);
  if (attempts >= limit) {
    throw new SessionError(
      `此創作空間已達生成次數上限（${limit} 次）。`,
      429,
    );
  }
}

async function performGeneration(
  id: string,
  overrides?: ImageGenerationOverrides | null,
  force = false,
) {
  const session = await getSession(id);
  assertSessionNotExpired(session);

  if (session.status === "complete" && !force) {
    return;
  }

  // Another isolate already owns a fresh lease — do not start a second billable
  // job. Same-isolate callers join via `activeGenerations` before this runs.
  if (isGenerationLeaseActive(session)) {
    return;
  }

  const settings = resolveImageOptions(overrides);

  // Gate before touching session status so a blocked fake leave the session ready.
  if (settings.fakeGenerate && !isImageTuningEnabled()) {
    throw new Error("假生成僅能在開發或 Preview 環境使用。");
  }

  // Forced re-render of a complete portrait, or any new attempt, burns a slot.
  // Taking over a stale `generating` lease reuses the attempt already counted.
  const reuseStaleAttempt =
    session.status === "generating" && !isGenerationLeaseActive(session);
  if (!reuseStaleAttempt) {
    assertGenerationBudget(session);
  }

  // Same reason: a session refused by the daily ceiling stays ready, so the
  // admin can run it tomorrow without it looking like a failed render. Fake
  // generation costs nothing and is never gated. A stale-lease takeover already
  // reserved spend for that attempt. Validate credentials before reserving so
  // a missing env var does not burn a daily slot.
  if (!settings.fakeGenerate && !reuseStaleAttempt) {
    openaiCredentials();
    await reserveSpend(
      session.source === "admin-batch" ? "batch" : "booth",
      settings,
    );
  }

  await markGenerating(id, !reuseStaleAttempt);

  try {
    if (settings.fakeGenerate) {
      await runFakeGeneration(id);
      return;
    }
    await runOpenAiGeneration(id, settings);
  } catch (error) {
    await markFailed(id, error);
    throw error;
  }
}

export function generateImage(
  id: string,
  overrides?: ImageGenerationOverrides | null,
  force = false,
) {
  // Even a forced retry joins a render that is already running. Starting a
  // second OpenAI call would bill twice and let whichever response lands last
  // overwrite the other, which is exactly what the guest-facing retry button
  // would otherwise do while the first render is still in flight.
  const existing = activeGenerations.get(id);
  if (existing) {
    return existing;
  }

  const generation = performGeneration(id, overrides, force).finally(() => {
    if (activeGenerations.get(id) === generation) {
      activeGenerations.delete(id);
    }
  });
  activeGenerations.set(id, generation);
  return generation;
}

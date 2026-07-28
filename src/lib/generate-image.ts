import OpenAI, { toFile } from "openai";
import {
  mimeForOutputFormat,
  resolveImageOptions,
  type ImageGenerationOverrides,
} from "@/lib/image-options";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import {
  getSession,
  readInputImage,
  updateSession,
  writeResultImage,
} from "@/lib/sessions";

const activeGenerations = new Map<string, Promise<void>>();
const FAKE_GENERATE_DELAY_MS = 1200;

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

async function performFakeGeneration(id: string) {
  await updateSession(id, { status: "generating", error: undefined });
  await new Promise((resolve) => setTimeout(resolve, FAKE_GENERATE_DELAY_MS));
  const input = await readInputImage(id);
  await writeResultImage(id, input.bytes, input.mime);
}

async function performGeneration(
  id: string,
  overrides?: ImageGenerationOverrides | null,
  force = false,
) {
  const session = await getSession(id);
  if (session.status === "complete" && !force) {
    return;
  }

  const settings = resolveImageOptions(overrides);

  if (settings.fakeGenerate) {
    if (!isImageTuningEnabled()) {
      throw new Error("假生成僅能在開發或 Preview 環境使用。");
    }
    await performFakeGeneration(id);
    return;
  }

  await updateSession(id, { status: "generating", error: undefined });

  try {
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
        settings.outputFormat === "png"
          ? undefined
          : settings.outputCompression,
      n: 1,
    });

    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) {
      throw new Error("OpenAI 未回傳圖片資料。");
    }

    await writeResultImage(
      id,
      Buffer.from(encoded, "base64"),
      mimeForOutputFormat(settings.outputFormat),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generation error";
    console.error(`Image generation failed for ${id}:`, error);
    await updateSession(id, { status: "failed", error: message });
    throw error;
  }
}

export function generateImage(
  id: string,
  overrides?: ImageGenerationOverrides | null,
  force = false,
) {
  const existing = activeGenerations.get(id);
  if (existing && !force) {
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

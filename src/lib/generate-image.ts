import OpenAI, { toFile } from "openai";
import {
  getSession,
  readInputImage,
  updateSession,
  writeResultImage,
} from "@/lib/sessions";

const activeGenerations = new Map<string, Promise<void>>();

function imageSettings() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const prompt = process.env.OPENAI_IMAGE_SYSTEM_PROMPT?.trim();

  if (!apiKey) {
    throw new Error("尚未設定 OPENAI_API_KEY。");
  }

  if (!prompt) {
    throw new Error("尚未設定 OPENAI_IMAGE_SYSTEM_PROMPT。");
  }

  const quality = process.env.OPENAI_IMAGE_QUALITY ?? "medium";
  if (!["low", "medium", "high", "auto"].includes(quality)) {
    throw new Error("OPENAI_IMAGE_QUALITY 必須是 low、medium、high 或 auto。");
  }

  return {
    apiKey,
    prompt,
    model: process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-2",
    quality: quality as "low" | "medium" | "high" | "auto",
    size: process.env.OPENAI_IMAGE_SIZE?.trim() || "1024x1024",
  };
}

async function performGeneration(id: string) {
  const session = await getSession(id);
  if (session.status === "complete") {
    return;
  }

  await updateSession(id, { status: "generating", error: undefined });

  try {
    const settings = imageSettings();
    const input = await readInputImage(id);
    const client = new OpenAI({ apiKey: settings.apiKey });
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
      prompt: settings.prompt,
      quality: settings.quality,
      size: settings.size,
      output_format: "jpeg",
      output_compression: 90,
      n: 1,
    });

    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) {
      throw new Error("OpenAI 未回傳圖片資料。");
    }

    await writeResultImage(id, Buffer.from(encoded, "base64"), "image/jpeg");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown generation error";
    console.error(`Image generation failed for ${id}:`, error);
    await updateSession(id, { status: "failed", error: message });
    throw error;
  }
}

export function generateImage(id: string) {
  const existing = activeGenerations.get(id);
  if (existing) {
    return existing;
  }

  const generation = performGeneration(id).finally(() => {
    activeGenerations.delete(id);
  });
  activeGenerations.set(id, generation);
  return generation;
}

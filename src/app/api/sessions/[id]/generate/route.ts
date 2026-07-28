import { generateImage } from "@/lib/generate-image";
import { parseImageOverrides } from "@/lib/image-options";
import { isImageTuningEnabled } from "@/lib/runtime-env";
import { getSession, publicSession, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const existing = await getSession(id);
    const tuningEnabled = isImageTuningEnabled();

    let overrides = null;
    let force = false;

    if (tuningEnabled) {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = (await request.json()) as Record<string, unknown>;
        overrides = parseImageOverrides(body);
        force = body.force === true;
      }
    }

    if (existing.status === "complete" && !force) {
      return Response.json(publicSession(existing), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    await generateImage(id, overrides, force);
    const session = await getSession(id);
    return Response.json(publicSession(session), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error && error.message.includes("OPENAI")) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (
      error instanceof Error &&
      (error.message.includes("不支援") ||
        error.message.includes("必須是") ||
        error.message.includes("outputCompression"))
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json(
      { error: "人像生成失敗，請重新拍攝後再試一次。" },
      { status: 500 },
    );
  }
}

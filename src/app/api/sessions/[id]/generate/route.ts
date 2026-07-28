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

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await request.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;

      if (body) {
        // `force` powers the guest-facing retry, so it is honoured everywhere.
        // Model/quality overrides stay gated behind the tuning environments.
        force = body.force === true;
        if (tuningEnabled) {
          overrides = parseImageOverrides(body);
        }
      }
    }

    if (existing.status === "complete" && !force) {
      return Response.json(publicSession(existing), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    // The guest-facing retry sends only `force`, so without this fallback a
    // retry would quietly re-render at the env defaults instead of the model,
    // size and quality the booth picked for this session.
    await generateImage(id, overrides ?? existing.generationOptions ?? null, force);
    const session = await getSession(id);
    return Response.json(publicSession(session), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    // Checked before the config branch: the quality error names the
    // OPENAI_IMAGE_QUALITY env var but is still a bad-request from the caller.
    if (
      error instanceof Error &&
      (error.message.includes("不支援") ||
        error.message.includes("必須是") ||
        error.message.includes("outputCompression"))
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    if (error instanceof Error && error.message.includes("OPENAI")) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json(
      { error: "人像生成失敗，請重新拍攝後再試一次。" },
      { status: 500 },
    );
  }
}

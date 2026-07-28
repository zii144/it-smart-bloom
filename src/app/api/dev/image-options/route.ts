import { defaultImageOptions } from "@/lib/image-options";
import { isImageTuningEnabled } from "@/lib/runtime-env";

export const runtime = "nodejs";

export async function GET() {
  if (!isImageTuningEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(
    {
      defaults: defaultImageOptions(),
      hasApiKey: Boolean(process.env.OPENAI_API_KEY?.trim()),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

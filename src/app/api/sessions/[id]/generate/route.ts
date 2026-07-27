import { generateImage } from "@/lib/generate-image";
import { getSession, publicSession, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const existing = await getSession(id);

    if (existing.status === "complete") {
      return Response.json(publicSession(existing), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    await generateImage(id);
    const session = await getSession(id);
    return Response.json(publicSession(session), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    return Response.json(
      { error: "人像生成失敗，請重新拍攝後再試一次。" },
      { status: 500 },
    );
  }
}

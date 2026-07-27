import {
  readInputImage,
  readResultImage,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const kind = new URL(request.url).searchParams.get("kind");

    if (kind !== "input" && kind !== "result") {
      return Response.json(
        { error: "圖片類型必須是 input 或 result。" },
        { status: 400 },
      );
    }

    const image =
      kind === "input" ? await readInputImage(id) : await readResultImage(id);

    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition":
          kind === "result"
            ? 'inline; filename="zhisheng-bloom-portrait.jpg"'
            : 'inline; filename="source-photo"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    console.error("Failed to serve image:", error);
    return Response.json({ error: "無法載入圖片。" }, { status: 500 });
  }
}

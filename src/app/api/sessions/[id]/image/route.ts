import {
  assertSessionNotExpired,
  extensionForMime,
  getSession,
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
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const asDownload = url.searchParams.get("download") === "1";

    if (kind !== "input" && kind !== "result") {
      return Response.json(
        { error: "圖片類型必須是 input 或 result。" },
        { status: 400 },
      );
    }

    const session = await getSession(id);
    assertSessionNotExpired(session);

    const image =
      kind === "input" ? await readInputImage(id) : await readResultImage(id);
    const extension = extensionForMime(image.mime);
    const filename =
      kind === "result"
        ? `zhisheng-bloom-portrait.${extension}`
        : `source-photo.${extension}`;

    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": image.mime,
        "Content-Length": String(image.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${filename}"`,
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

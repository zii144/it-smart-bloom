import {
  ADMIN_COOKIE_NAME,
  resolveAdminAuth,
} from "@/lib/admin-auth";
import {
  readArchiveImage,
  readArchiveRecord,
} from "@/lib/portrait-archive";
import {
  readInputImage,
  readResultImage,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

function imageResponse(
  bytes: Buffer,
  mime: string,
  kind: "input" | "result",
) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
      "Content-Disposition":
        kind === "result"
          ? 'inline; filename="zhisheng-bloom-portrait.jpg"'
          : 'inline; filename="source-photo"',
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = resolveAdminAuth({
    cookieToken: readCookie(request, ADMIN_COOKIE_NAME),
    authorization: request.headers.get("authorization"),
    key: new URL(request.url).searchParams.get("key"),
  });

  if (!auth.ok) {
    if (auth.reason === "disabled") {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": 'Basic realm="Bloom Admin", charset="UTF-8"',
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const { id } = await params;
    const kind = new URL(request.url).searchParams.get("kind");

    if (kind !== "input" && kind !== "result") {
      return Response.json(
        { error: "圖片類型必須是 input 或 result。" },
        { status: 400 },
      );
    }

    try {
      const local =
        kind === "input" ? await readInputImage(id) : await readResultImage(id);
      return imageResponse(local.bytes, local.mime, kind);
    } catch (error) {
      if (!(error instanceof SessionError)) {
        throw error;
      }
    }

    const record = await readArchiveRecord(id);
    const objectPath =
      kind === "input"
        ? record?.storage.inputPath
        : record?.storage.resultPath;

    if (!record || !objectPath) {
      return Response.json(
        { error: "目前無法取得圖片。" },
        { status: 404 },
      );
    }

    const archived = await readArchiveImage(objectPath);
    if (!archived) {
      return Response.json(
        { error: "目前無法取得圖片。" },
        { status: 404 },
      );
    }

    const mime =
      kind === "input"
        ? record.inputMime || archived.mime
        : record.resultMime || archived.mime;

    return imageResponse(archived.bytes, mime, kind);
  } catch (error) {
    console.error("Failed to serve admin archive image:", error);
    return Response.json({ error: "無法載入圖片。" }, { status: 500 });
  }
}

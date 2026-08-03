import { ADMIN_COOKIE_NAME, resolveAdminAuth } from "@/lib/admin-auth";
import { generateImage } from "@/lib/generate-image";
import {
  parseImageOverrides,
  resolveImageOptions,
} from "@/lib/image-options";
import { archiveSessionCreated } from "@/lib/portrait-archive";
import {
  createSession,
  getSession,
  readInputImage,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";
// One portrait per request: the admin batch UI drives the queue client-side so
// a single slow render can never blow the whole batch's function timeout.
export const maxDuration = 300;

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

export async function POST(request: Request) {
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
    const formData = await request.formData();
    const image = formData.get("image");

    if (!(image instanceof File)) {
      return Response.json({ error: "請提供一張照片。" }, { status: 400 });
    }

    // No overrides means the env defaults; the prompt itself always comes from
    // OPENAI_IMAGE_SYSTEM_PROMPT inside generateImage.
    let options;
    const rawOptions = formData.get("imageOptions");
    try {
      options = resolveImageOptions(
        typeof rawOptions === "string" && rawOptions.trim()
          ? parseImageOverrides(JSON.parse(rawOptions))
          : null,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "圖片參數無效。";
      return Response.json({ error: message }, { status: 400 });
    }

    const session = await createSession(image, options, "admin-batch");

    // Archive before rendering so the result has somewhere durable to land even
    // if the next request hits a different Vercel isolate.
    try {
      const input = await readInputImage(session.id);
      await archiveSessionCreated(session, input);
    } catch (error) {
      console.error(`Failed to archive batch session ${session.id}:`, error);
    }

    await generateImage(session.id, options);
    const finished = await getSession(session.id);

    return Response.json(
      {
        id: finished.id,
        status: finished.status,
        createdAt: finished.createdAt,
        inputUrl: `/api/admin30910/sessions/${finished.id}/image?kind=input`,
        resultUrl:
          finished.status === "complete"
            ? `/api/admin30910/sessions/${finished.id}/image?kind=result`
            : null,
        resultMime: finished.resultMime ?? null,
        generationOptions: finished.generationOptions ?? null,
        error: finished.error ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }

    if (
      error instanceof Error &&
      (error.message.includes("不支援") ||
        error.message.includes("必須是") ||
        error.message.includes("outputCompression"))
    ) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    // Admin-only surface: pass the real reason through so ops can act on it
    // (missing prompt, OpenAI rate limit, content policy) without the logs.
    console.error("Admin batch generation failed:", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "批次生成失敗，請稍後再試。";
    return Response.json({ error: message }, { status: 500 });
  }
}

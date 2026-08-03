import { isImageTuningEnabled } from "@/lib/runtime-env";

export const runtime = "nodejs";

/** Mirrors the ceilings in the real RT function spec (plan §6). */
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Local stand-in for the road-teacher `setAvatar` Cloud Function
 * (docs/road-teacher-auth-plan.md §6). Enforces the same request contract —
 * bearer token, same-origin portraitUrl, image MIME and size ceilings — so the
 * mock flow fails in the same places the real one would. Writes nothing; the
 * response carries `mock: true` and the UI must surface that honestly.
 */
export async function POST(request: Request) {
  if (!isImageTuningEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return Response.json({ error: "缺少登入憑證。" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    portraitUrl?: unknown;
  } | null;
  const portraitUrl =
    typeof body?.portraitUrl === "string" ? body.portraitUrl : "";
  // An empty string would resolve relative to the request URL itself.
  if (!portraitUrl) {
    return Response.json({ error: "圖片連結格式不正確。" }, { status: 400 });
  }

  // Same-origin pin, like the real function pins the Bloom host (SSRF guard).
  let url: URL;
  try {
    url = new URL(portraitUrl, request.url);
  } catch {
    return Response.json({ error: "圖片連結格式不正確。" }, { status: 400 });
  }
  if (url.origin !== new URL(request.url).origin) {
    return Response.json({ error: "不允許的圖片來源。" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url, { redirect: "error" });
  } catch {
    return Response.json({ error: "無法取得人像圖片。" }, { status: 502 });
  }
  if (!upstream.ok) {
    return Response.json({ error: "無法取得人像圖片。" }, { status: 502 });
  }

  const mime =
    upstream.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
  if (!ALLOWED_MIME.has(mime)) {
    return Response.json({ error: "不支援的圖片格式。" }, { status: 415 });
  }

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: "圖片大小不符合限制。" }, { status: 413 });
  }

  return Response.json(
    { ok: true, mock: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

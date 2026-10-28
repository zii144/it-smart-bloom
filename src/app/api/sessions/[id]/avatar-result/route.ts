import { markAvatarRequest } from "@/lib/portrait-archive";
import {
  assertSessionNotExpired,
  getSession,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";

/** Advisory client-reported bookkeeping only. Never proof that RT changed an avatar. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { id } = await params;
    const session = await getSession(id);
    assertSessionNotExpired(session);
    if (session.status !== "complete")
      return Response.json(
        { error: "人像尚未完成。" },
        { status: 409, headers },
      );
    const body = await request.json().catch(() => null);
    if (!body || typeof body.ok !== "boolean")
      return Response.json(
        { error: "回報格式不正確。" },
        { status: 400, headers },
      );
    // Do not store arbitrary client error text or any RT credentials/identifiers.
    await markAvatarRequest(
      id,
      body.ok ? { ok: true } : { ok: false, error: "用戶端回報替換未完成。" },
    );
    return Response.json({ ok: true, reported: true }, { headers });
  } catch (error) {
    return Response.json(
      { error: "暫時無法記錄結果。" },
      { status: error instanceof SessionError ? error.status : 503, headers },
    );
  }
}

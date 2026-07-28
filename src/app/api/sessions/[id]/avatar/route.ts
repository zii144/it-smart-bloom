import { markAvatarRequest } from "@/lib/portrait-archive";
import { requestRoadTeacherAvatar } from "@/lib/road-teacher-avatar";
import {
  getSession,
  publicSession,
  readResultImage,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);

    if (!session.identity) {
      return Response.json(
        { error: "請先填寫路老師通用 Line ID 或手機號碼。" },
        { status: 400 },
      );
    }

    if (session.status !== "complete") {
      return Response.json(
        { error: "人像尚未完成，請稍候再試。" },
        { status: 409 },
      );
    }

    const result = await readResultImage(id);

    try {
      await requestRoadTeacherAvatar({
        sessionId: id,
        identityKind: session.identity.kind,
        identityValue: session.identity.value,
        imageBytes: result.bytes,
        imageMime: result.mime,
      });
      await markAvatarRequest(id, { ok: true });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "路老師系統暫時無法使用。";
      await markAvatarRequest(id, { ok: false, error: message });
      return Response.json({ error: message }, { status: 502 });
    }

    return Response.json(
      {
        ...publicSession(session),
        avatarRequested: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SessionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to request road-teacher avatar:", error);
    return Response.json(
      { error: "無法替換路老師系統大頭貼，請稍後再試。" },
      { status: 500 },
    );
  }
}

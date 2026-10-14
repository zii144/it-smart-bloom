import { markAvatarRequest } from "@/lib/portrait-archive";
import {
  RoadTeacherAvatarError,
  requestRoadTeacherAvatar,
} from "@/lib/road-teacher-avatar";
import {
  getSession,
  publicSession,
  readResultImage,
  SessionError,
} from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Archive bookkeeping is best effort: it must never change what the guest is told. */
async function recordOutcome(
  id: string,
  outcome: { ok: true } | { ok: false; error: string },
) {
  await markAvatarRequest(id, outcome).catch((error) => {
    console.error("Failed to record avatar outcome:", error);
  });
}

/**
 * Sets the finished portrait as the guest's 路老師 avatar, using the 姓名 +
 * 手機號碼 they entered at the booth. Road-teacher decides which teacher that
 * is; this route never accepts an identity from the request.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await getSession(id);

    if (!session.identity) {
      return Response.json(
        { error: "這張作品沒有留下姓名與手機，無法替換大頭貼。" },
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

    let mock = false;
    try {
      ({ mock } = await requestRoadTeacherAvatar({
        sessionId: id,
        name: session.identity.name,
        mobile: session.identity.mobile,
        imageBytes: result.bytes,
        imageMime: result.mime,
      }));
      if (!mock) await recordOutcome(id, { ok: true });
    } catch (error) {
      if (error instanceof RoadTeacherAvatarError) {
        await recordOutcome(id, { ok: false, error: error.code });
        return Response.json(
          { error: error.message, code: error.code },
          { status: error.status },
        );
      }
      throw error;
    }

    return Response.json(
      { ...publicSession(session), avatarRequested: true, mock },
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

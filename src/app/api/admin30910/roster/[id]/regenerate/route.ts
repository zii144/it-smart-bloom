import { adminRouteGuard } from "@/lib/admin-route";
import { generateImage } from "@/lib/generate-image";
import { SpendLimitError } from "@/lib/image-spend";
import { RosterInputError } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  readRosterFailedPortraitSession,
  RosterNotFoundError,
} from "@/lib/roster-store";
import { getSession, SessionError } from "@/lib/sessions";

export const runtime = "nodejs";
/** Same budget as the guest generate route: one OpenAI render. */
export const maxDuration = 180;

const ROSTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** OpenAI's own wording names the account problem; staff need it plainly. */
function openAiFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/invalid_api_key|incorrect api key/i.test(message)) {
    return "OpenAI API 金鑰無效，請確認伺服器的 OPENAI_API_KEY。";
  }
  if (/no credits|insufficient_quota|billing/i.test(message)) {
    return "OpenAI 額度不足，請先儲值後再重新生成。";
  }
  if (/\b429\b|rate limit/i.test(message)) {
    return "OpenAI 暫時忙碌，請稍候再試。";
  }
  return "生成失敗，請稍後再試。";
}

/**
 * `POST /api/admin30910/roster/:id/regenerate` — runs a guest's failed render
 * again from the photo they already submitted, in the same session. Only for
 * a failed portrait: a finished one is never billed twice (adjust it through
 * `…/portrait` instead). Success marks the guest's portrait complete, so
 * check-in hands it over.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = adminRouteGuard(request);
  if (denied) return denied;

  try {
    const { id } = await params;
    if (!ROSTER_ID_PATTERN.test(id)) throw new RosterNotFoundError();
    const sessionId = await readRosterFailedPortraitSession(id);
    if (!sessionId) {
      throw new RosterInputError("這位來賓沒有生成失敗的作品，不需要重新生成。");
    }

    const session = await getSession(sessionId);
    try {
      // Keep the model, size and quality the booth chose for this guest.
      await generateImage(sessionId, session.generationOptions ?? null, false, {
        asAdmin: true,
      });
    } catch (error) {
      if (error instanceof SessionError || error instanceof SpendLimitError) {
        return rosterJson({ error: error.message }, error.status);
      }
      console.error(`Admin regeneration failed for ${sessionId}:`, error);
      return rosterJson({ error: openAiFailureMessage(error) }, 502);
    }

    const finished = await getSession(sessionId);
    return rosterJson({ portraitStatus: finished.status });
  } catch (error) {
    if (error instanceof SessionError) {
      return rosterJson({ error: "找不到這位來賓上傳的照片。" }, error.status);
    }
    return rosterErrorResponse(error, "regenerate guest portrait");
  }
}

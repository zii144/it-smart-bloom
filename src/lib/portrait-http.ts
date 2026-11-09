import {
  FinalResultInputError,
  FinalResultUnavailableError,
} from "@/lib/portrait-archive";
import { PreviewError } from "@/lib/portrait-preview";
import { RosterInputError } from "@/lib/roster";
import { rosterErrorResponse, rosterJson } from "@/lib/roster-http";
import {
  readRosterAdjustableSession,
  readRosterPortraitSession,
  RosterNotFoundError,
} from "@/lib/roster-store";
import { SessionError } from "@/lib/sessions";

const ROSTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The guest's finished portrait session; adjustments only apply to that. */
export async function portraitSessionFor(id: string) {
  if (!ROSTER_ID_PATTERN.test(id)) throw new RosterNotFoundError();
  const sessionId = await readRosterPortraitSession(id);
  if (!sessionId) throw new RosterInputError("這位來賓還沒有完成的似顏繪。");
  return sessionId;
}

/**
 * Where an uploaded adjustment goes: the finished portrait, or a failed one
 * that the upload completes (`failed: true`) so no regeneration is needed.
 */
export async function adjustableSessionFor(id: string) {
  if (!ROSTER_ID_PATTERN.test(id)) throw new RosterNotFoundError();
  const target = await readRosterAdjustableSession(id);
  if (!target) throw new RosterInputError("這位來賓還沒有作品可調整（沒有上傳照片，或仍在生成中）。");
  return target;
}

export function portraitErrorResponse(error: unknown, action: string) {
  if (error instanceof SessionError) {
    return rosterJson({ error: error.message }, error.status);
  }
  if (error instanceof FinalResultInputError || error instanceof PreviewError) {
    return rosterJson({ error: error.message }, 400);
  }
  if (error instanceof FinalResultUnavailableError) {
    return rosterJson({ error: error.message }, 503);
  }
  return rosterErrorResponse(error, action);
}

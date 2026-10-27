import type { SuccessView } from "@/components/success-card";
import { EVENT_RUNDOWN_URL } from "@/lib/event-info";
import { readRosterGuest } from "@/lib/roster-store";
import { brandedQrDataUrl } from "@/lib/session-share";
import { getSession, isSessionExpired, SessionError } from "@/lib/sessions";

/**
 * Builds the success card for a booth session; never throws for bad links.
 * The portrait itself is handed out at check-in, so the card only confirms
 * the submission and points to the event rundown.
 */
export async function loadSuccessView(sessionId: string): Promise<SuccessView> {
  let session;
  try {
    session = await getSession(sessionId);
  } catch (error) {
    if (error instanceof SessionError) return { kind: "missing" };
    throw error;
  }
  if (isSessionExpired(session)) return { kind: "expired" };

  // The greeting is a nicety: a deleted entry or a Firestore hiccup still
  // shows the card, just without the name.
  let guest: { name: string } | null = null;
  if (session.rosterEntryId) {
    try {
      guest = await readRosterGuest(session.rosterEntryId);
    } catch (error) {
      console.error("Failed to read roster guest for success card:", error);
    }
  }

  return {
    kind: "ready",
    guestName: guest?.name ?? null,
    rundownUrl: EVENT_RUNDOWN_URL,
    rundownQrDataUrl: await brandedQrDataUrl(EVENT_RUNDOWN_URL),
  };
}

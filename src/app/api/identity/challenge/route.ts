import { errorJson, errorResponse } from "@/lib/api-errors";
import { parseGuestIdentity } from "@/lib/guest-identity";
import { assertNotLocked, lockoutKey } from "@/lib/identity-lockout";
import { requestIdentityChallenge } from "@/lib/road-teacher-identity";

export const runtime = "nodejs";

/**
 * Starts the booth identity challenge: given a phone number, returns the name
 * line-up the guest picks from. Requesting a challenge does not spend an
 * attempt — only a wrong answer does — but a locked-out number cannot get one.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body) {
      return errorJson("IDENTITY_REQUIRED", "請提供手機號碼。", 400);
    }

    const identity = parseGuestIdentity({ mobile: body.mobile });
    const state = await assertNotLocked(lockoutKey(identity));
    const challenge = await requestIdentityChallenge(identity);

    return Response.json(
      {
        challengeId: challenge.challengeId,
        options: challenge.options,
        expiresAt: challenge.expiresAt,
        attemptsRemaining: state.attemptsRemaining,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "Failed to start the identity challenge", {
      message: "目前無法驗證手機號碼，請稍後再試。",
    });
  }
}

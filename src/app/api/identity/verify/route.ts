import { errorJson, errorResponse } from "@/lib/api-errors";
import { parseGuestIdentity } from "@/lib/guest-identity";
import { issueIdentityToken } from "@/lib/identity-token";
import {
  assertNotLocked,
  clearAttempts,
  lockoutKey,
  recordFailedAttempt,
} from "@/lib/identity-lockout";
import { verifyIdentityAnswer } from "@/lib/road-teacher-identity";

export const runtime = "nodejs";

/**
 * Grades one answer. A correct pick clears the attempt counter and returns a
 * signed identity token; a wrong one is counted, and the fifth inside the window
 * locks that number out for thirty minutes.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body) {
      return errorJson("IDENTITY_REQUIRED", "請提供驗證資料。", 400);
    }

    const identity = parseGuestIdentity({ mobile: body.mobile });
    const challengeId =
      typeof body.challengeId === "string" ? body.challengeId : "";
    const answer = typeof body.answer === "string" ? body.answer : "";

    if (!challengeId || !answer) {
      return errorJson("IDENTITY_REQUIRED", "請選擇一個名字。", 400);
    }

    // Checked before the answer is graded, so a locked number gets no feedback
    // it could learn from.
    const key = lockoutKey(identity);
    await assertNotLocked(key);

    const outcome = await verifyIdentityAnswer(challengeId, answer);

    // The mobile comes back out of the sealed challenge, so a caller cannot
    // answer one number's challenge and claim the token for another.
    if (!outcome.verified || outcome.mobile !== identity.value) {
      const state = await recordFailedAttempt(key);
      return Response.json(
        {
          error: state.attemptsRemaining
            ? `名字不正確，還可以再試 ${state.attemptsRemaining} 次。`
            : "名字不正確。",
          code: "IDENTITY_ANSWER_WRONG",
          attemptsRemaining: state.attemptsRemaining,
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    await clearAttempts(key);
    const { token, expiresAt } = issueIdentityToken(identity);

    return Response.json(
      { identityToken: token, expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, "Failed to verify the identity challenge", {
      message: "目前無法驗證手機號碼，請稍後再試。",
    });
  }
}

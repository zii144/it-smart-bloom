/**
 * Calls the road-teacher system to set the guest's portrait as their
 * official avatar / deliver it over LINE. The remote API lives outside this
 * repo; we only POST the finished image plus the identity they claimed.
 */
export async function requestRoadTeacherAvatar(input: {
  sessionId: string;
  identityKind: "lineId" | "mobile";
  identityValue: string;
  imageBytes: Buffer;
  imageMime: string;
}) {
  const endpoint = process.env.ROAD_TEACHER_AVATAR_API_URL?.trim();
  if (!endpoint) {
    throw new Error("尚未設定 ROAD_TEACHER_AVATAR_API_URL。");
  }

  const form = new FormData();
  form.set("sessionId", input.sessionId);
  form.set("identityKind", input.identityKind);
  form.set("identityValue", input.identityValue);
  form.set(
    "image",
    new Blob([new Uint8Array(input.imageBytes)], { type: input.imageMime }),
    "portrait.jpg",
  );

  const headers: HeadersInit = {};
  const apiKey = process.env.ROAD_TEACHER_AVATAR_API_KEY?.trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string };
      detail = payload.error ? `：${payload.error}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`路老師系統回應 ${response.status}${detail}`);
  }

  return response.json().catch(() => ({ ok: true }));
}

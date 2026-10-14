import { readdir } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/sessions/route";
import {
  IDENTITY_TOKEN_TTL_MS,
  issueIdentityToken,
} from "@/lib/identity-token";
import { getSession } from "@/lib/sessions";
import { imageFile, jpegBytes } from "./helpers";

const MOBILE = "0912345678";

/** A number only reaches this route as a token from /api/identity/verify. */
function identityTokenFor(value = MOBILE) {
  return issueIdentityToken({ kind: "mobile", value }).token;
}

const { afterMock, generateImageMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
  generateImageMock: vi.fn(),
}));

vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("@/lib/generate-image", () => ({ generateImage: generateImageMock }));

/** Run the work the route handed to `after()`, the way the server would. */
async function flushAfterCallbacks() {
  for (const [callback] of afterMock.mock.calls) {
    await callback();
  }
}

function createRequest({
  file = imageFile(),
  imageOptions,
  identityToken = identityTokenFor(),
}: {
  file?: File;
  imageOptions?: string;
  identityToken?: string;
} = {}) {
  const body = new FormData();
  body.set("image", file);
  if (imageOptions !== undefined) {
    body.set("imageOptions", imageOptions);
  }
  if (identityToken !== undefined) {
    body.set("identityToken", identityToken);
  }
  return new Request("http://booth.local/api/sessions", {
    method: "POST",
    body,
  });
}

/** The only durable evidence that a rejected request created nothing. */
async function storedSessionCount() {
  return (await readdir(process.env.BLOOM_DATA_DIR!)).length;
}

beforeEach(() => {
  process.env.IDENTITY_KEY_SECRET = "test-identity-secret";
  afterMock.mockReset();
  generateImageMock.mockReset();
  generateImageMock.mockResolvedValue(undefined);
});

describe("POST /api/sessions", () => {
  it("creates a session and returns the QR payload the booth needs", async () => {
    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload).toMatchObject({ status: "ready", resultUrl: null });
    expect(payload.sessionUrl).toBe(`http://booth.local/s/${payload.id}`);
    expect(payload.qrDataUrl.startsWith("data:image/png;base64,")).toBe(true);

    await expect(getSession(payload.id)).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("stores the verified mobile number with the portrait", async () => {
    const response = await POST(createRequest());
    const payload = await response.json();

    expect(response.status).toBe(201);
    await expect(getSession(payload.id)).resolves.toMatchObject({
      identity: { kind: "mobile", value: MOBILE },
    });
  });

  // The session id is printed as a QR code and GET /api/sessions/[id] is
  // unauthenticated, so the number must never travel in this shape.
  it("never returns the guest's number in the session payload", async () => {
    const payload = await (await POST(createRequest())).json();

    expect(payload.identityClaimed).toBe(true);
    expect(payload.identity).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain(MOBILE);
  });

  it("treats an absent token as no number rather than an error", async () => {
    const response = await POST(createRequest({ identityToken: "" }));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.identityClaimed).toBe(false);
  });

  // The whole point of the token: a number cannot be self-asserted here.
  it("refuses a forged token before creating the portrait", async () => {
    const before = await storedSessionCount();
    const forged = `v1.${Buffer.from(
      JSON.stringify({
        kind: "mobile",
        value: MOBILE,
        expiresAt: Date.now() + 60_000,
      }),
      "utf8",
    ).toString("base64url")}.not-a-real-signature`;

    const response = await POST(createRequest({ identityToken: forged }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_TOKEN_INVALID",
    });
    // Asserts the ordering the test name claims: nothing was written to disk.
    expect(await storedSessionCount()).toBe(before);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("refuses a token signed with a different secret", async () => {
    const token = identityTokenFor();
    process.env.IDENTITY_KEY_SECRET = "a-different-secret";

    const response = await POST(createRequest({ identityToken: token }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "IDENTITY_TOKEN_INVALID",
    });
  });

  it("refuses an expired token", async () => {
    vi.useFakeTimers();
    try {
      const token = identityTokenFor();
      vi.advanceTimersByTime(IDENTITY_TOKEN_TTL_MS + 1000);

      const response = await POST(createRequest({ identityToken: token }));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "IDENTITY_TOKEN_INVALID",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("builds the share link from APP_BASE_URL when configured", async () => {
    process.env.APP_BASE_URL = "https://bloom.example.com/";
    const payload = await (await POST(createRequest())).json();

    expect(payload.sessionUrl).toBe(
      `https://bloom.example.com/s/${payload.id}`,
    );
  });

  it("starts rendering immediately so the phone never has to", async () => {
    const payload = await (await POST(createRequest())).json();

    await flushAfterCallbacks();
    expect(generateImageMock).toHaveBeenCalledWith(payload.id, null);
  });

  it("keeps the session usable when the background render throws", async () => {
    generateImageMock.mockRejectedValue(new Error("OpenAI exploded"));

    const payload = await (await POST(createRequest())).json();
    await expect(flushAfterCallbacks()).resolves.toBeUndefined();
    await expect(getSession(payload.id)).resolves.toMatchObject({
      id: payload.id,
    });
  });

  it("rejects a request without a photo", async () => {
    const body = new FormData();
    body.set("image", "not-a-file");
    const response = await POST(
      new Request("http://booth.local/api/sessions", { method: "POST", body }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "IMAGE_REQUIRED" });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("surfaces an upload that is too large", async () => {
    const response = await POST(
      createRequest({ file: imageFile(jpegBytes(13 * 1024 * 1024)) }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(afterMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions — image tuning disabled (production)", () => {
  it("ignores booth-supplied options and renders with the defaults", async () => {
    const payload = await (
      await POST(createRequest({ imageOptions: '{"model":"gpt-image-1"}' }))
    ).json();

    expect(payload.generationOptions).toBeNull();
    await flushAfterCallbacks();
    expect(generateImageMock).toHaveBeenCalledWith(payload.id, null);
  });
});

describe("POST /api/sessions — image tuning enabled (dev/preview)", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
  });

  it("stores the chosen options and renders with them", async () => {
    const payload = await (
      await POST(
        createRequest({
          imageOptions:
            '{"model":"gpt-image-1","quality":"low","fakeGenerate":true}',
        }),
      )
    ).json();

    expect(payload.generationOptions).toMatchObject({
      model: "gpt-image-1",
      quality: "low",
      fakeGenerate: true,
    });

    await flushAfterCallbacks();
    expect(generateImageMock).toHaveBeenCalledWith(
      payload.id,
      expect.objectContaining({ model: "gpt-image-1", fakeGenerate: true }),
    );
  });

  it("waits for the dev modal when no options were chosen", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(201);
    await flushAfterCallbacks();
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("rejects invalid options instead of silently falling back", async () => {
    const response = await POST(
      createRequest({ imageOptions: '{"model":"dall-e-9"}' }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "IMAGE_OPTIONS_INVALID",
    });
    expect(afterMock).not.toHaveBeenCalled();
  });
});

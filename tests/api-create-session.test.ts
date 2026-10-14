import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/sessions/route";
import { getSession } from "@/lib/sessions";
import { imageFile, jpegBytes } from "./helpers";

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

function createRequest(
  file = imageFile(),
  imageOptions?: string,
  identity?: { name?: string; mobile?: string },
) {
  const body = new FormData();
  body.set("image", file);
  if (imageOptions !== undefined) {
    body.set("imageOptions", imageOptions);
  }
  if (identity?.name !== undefined) body.set("name", identity.name);
  if (identity?.mobile !== undefined) body.set("mobile", identity.mobile);
  return new Request("http://booth.local/api/sessions", {
    method: "POST",
    body,
  });
}

beforeEach(() => {
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

  it("stores the guest's name and mobile without returning them", async () => {
    const response = await POST(
      createRequest(imageFile(), undefined, {
        name: "張小明",
        mobile: "0912-345-678",
      }),
    );
    const text = await response.text();
    const payload = JSON.parse(text);

    expect(response.status).toBe(201);
    expect(payload.identityClaimed).toBe(true);
    // The response feeds the booth's QR screen; the session id it carries is
    // public, so the identity must stay server-side.
    expect(text).not.toContain("0912345678");
    expect(text).not.toContain("張小明");
    await expect(getSession(payload.id)).resolves.toMatchObject({
      identity: { name: "張小明", mobile: "0912345678" },
    });
  });

  it.each([
    [{ name: "張小明" }],
    [{ mobile: "0912345678" }],
    [{ name: "張小明", mobile: "12345" }],
  ])("rejects an incomplete identity %p before creating the portrait", async (identity) => {
    const response = await POST(createRequest(imageFile(), undefined, identity));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("creates a session without identity when neither field is sent", async () => {
    const payload = await (await POST(createRequest())).json();
    expect(payload.identityClaimed).toBe(false);
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
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("surfaces an upload that is too large", async () => {
    const response = await POST(
      createRequest(imageFile(jpegBytes(13 * 1024 * 1024))),
    );
    expect(response.status).toBe(413);
    expect(afterMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/sessions — image tuning disabled (production)", () => {
  it("ignores booth-supplied options and renders with the defaults", async () => {
    const payload = await (
      await POST(createRequest(imageFile(), '{"model":"gpt-image-1"}'))
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
        createRequest(
          imageFile(),
          '{"model":"gpt-image-1","quality":"low","fakeGenerate":true}',
        ),
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
      createRequest(imageFile(), '{"model":"dall-e-9"}'),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
    expect(afterMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getImage } from "@/app/api/sessions/[id]/image/route";
import { GET as getStatus } from "@/app/api/sessions/[id]/route";
import { POST as postGenerate } from "@/app/api/sessions/[id]/generate/route";
import {
  createSession,
  getSession,
  updateSession,
  writeResultImage,
} from "@/lib/sessions";
import {
  expiredAt,
  imageFile,
  jpegBytes,
  patchMetadata,
  pngBytes,
  routeContext,
} from "./helpers";

const { generateImageMock } = vi.hoisted(() => ({
  generateImageMock: vi.fn(),
}));

vi.mock("@/lib/generate-image", () => ({ generateImage: generateImageMock }));

/** Stand-in for a successful render, so the route sees a completed session. */
function rendersSuccessfully(payload = "portrait") {
  generateImageMock.mockImplementation(async (id: string) => {
    await writeResultImage(id, Buffer.from(payload), "image/jpeg");
  });
}

function generateRequest(body?: unknown) {
  return new Request("http://phone.local/api/sessions/x/generate", {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

function imageRequest(kind: string | null) {
  const url = new URL("http://phone.local/api/sessions/x/image");
  if (kind !== null) url.searchParams.set("kind", kind);
  return new Request(url);
}

beforeEach(() => {
  generateImageMock.mockReset();
  generateImageMock.mockResolvedValue(undefined);
});

describe("GET /api/sessions/[id]", () => {
  it("returns the public view the phone polls", async () => {
    const session = await createSession(imageFile());
    const response = await getStatus(
      new Request("http://phone.local"),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      id: session.id,
      status: "ready",
      resultUrl: null,
    });
  });

  it("reports progress once rendering has started", async () => {
    const session = await createSession(imageFile());
    await updateSession(session.id, {
      status: "generating",
      generationStartedAt: "2026-01-01T00:00:00.000Z",
    });

    const payload = await (
      await getStatus(new Request("http://phone.local"), routeContext(session.id))
    ).json();

    expect(payload).toMatchObject({
      status: "generating",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("404s an unknown session", async () => {
    const response = await getStatus(
      new Request("http://phone.local"),
      routeContext("a".repeat(32)),
    );
    expect(response.status).toBe(404);
  });

  it("410s an expired session", async () => {
    const session = await createSession(imageFile());
    await patchMetadata(session.id, { expiresAt: expiredAt() });

    const response = await getStatus(
      new Request("http://phone.local"),
      routeContext(session.id),
    );
    expect(response.status).toBe(410);
  });
});

describe("POST /api/sessions/[id]/generate", () => {
  it("renders and returns the completed session", async () => {
    rendersSuccessfully();
    const session = await createSession(imageFile());

    const response = await postGenerate(
      generateRequest(),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "complete",
      resultUrl: `/api/sessions/${session.id}/image?kind=result`,
    });
  });

  it("is a no-op for an already finished session", async () => {
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    const response = await postGenerate(
      generateRequest(),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(generateImageMock).not.toHaveBeenCalled();
  });

  it("honours a forced retry even when tuning is off", async () => {
    rendersSuccessfully("second-take");
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    const response = await postGenerate(
      generateRequest({ force: true }),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(generateImageMock).toHaveBeenCalledWith(session.id, null, true);
  });

  it("retries with the options the booth chose, not the env defaults", async () => {
    rendersSuccessfully();
    const booth = {
      model: "gpt-image-1.5",
      quality: "high",
      size: "1536x1024",
      outputFormat: "webp",
      outputCompression: 70,
      fakeGenerate: false,
    } as const;
    const session = await createSession(imageFile(), booth);
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");

    // The guest-facing retry button sends only `force`.
    await postGenerate(
      generateRequest({ force: true }),
      routeContext(session.id),
    );

    expect(generateImageMock).toHaveBeenCalledWith(session.id, booth, true);
  });

  it("ignores model overrides when tuning is off", async () => {
    const session = await createSession(imageFile());

    await postGenerate(
      generateRequest({ model: "gpt-image-1", quality: "high" }),
      routeContext(session.id),
    );

    expect(generateImageMock).toHaveBeenCalledWith(session.id, null, false);
  });

  it("applies overrides when tuning is on", async () => {
    process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
    const session = await createSession(imageFile());

    await postGenerate(
      generateRequest({ model: "gpt-image-1", quality: "high", force: true }),
      routeContext(session.id),
    );

    expect(generateImageMock).toHaveBeenCalledWith(
      session.id,
      { model: "gpt-image-1", quality: "high" },
      true,
    );
  });

  it("survives a request with no body at all", async () => {
    const session = await createSession(imageFile());
    const response = await postGenerate(
      new Request("http://phone.local", { method: "POST" }),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(generateImageMock).toHaveBeenCalledWith(session.id, null, false);
  });

  it("410s an expired session", async () => {
    const session = await createSession(imageFile());
    await patchMetadata(session.id, { expiresAt: expiredAt() });

    const response = await postGenerate(
      generateRequest(),
      routeContext(session.id),
    );
    expect(response.status).toBe(410);
  });

  it.each([
    "不支援的圖片尺寸。",
    "OPENAI_IMAGE_QUALITY 必須是 low、medium、high 或 auto。",
    "outputCompression 必須是 0–100 的整數。",
  ])("maps the validation error %j to a 400", async (message) => {
    process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
    generateImageMock.mockRejectedValue(new Error(message));
    const session = await createSession(imageFile());

    const response = await postGenerate(
      generateRequest({ size: "42x42" }),
      routeContext(session.id),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
  });

  it("surfaces a missing OpenAI configuration as a 500", async () => {
    generateImageMock.mockRejectedValue(new Error("尚未設定 OPENAI_API_KEY。"));
    const session = await createSession(imageFile());

    const response = await postGenerate(
      generateRequest(),
      routeContext(session.id),
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: "尚未設定 OPENAI_API_KEY。",
    });
  });

  it("returns a guest-safe 500 when rendering blows up", async () => {
    generateImageMock.mockRejectedValue(new Error("upstream timeout"));
    const session = await createSession(imageFile());

    const response = await postGenerate(
      generateRequest(),
      routeContext(session.id),
    );

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.error).toBe("人像生成失敗，請重新拍攝後再試一次。");
    expect(payload.error).not.toContain("timeout");
  });
});

describe("GET /api/sessions/[id]/image", () => {
  it("serves the source photo", async () => {
    const bytes = jpegBytes(128);
    const session = await createSession(imageFile(bytes));

    const response = await getImage(
      imageRequest("input"),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("serves the finished portrait", async () => {
    const session = await createSession(imageFile());
    const result = pngBytes(200);
    await writeResultImage(session.id, result, "image/png");

    const response = await getImage(
      imageRequest("result"),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Length")).toBe(
      String(result.byteLength),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(result);
  });

  it("409s when the portrait is still rendering", async () => {
    const session = await createSession(imageFile());
    const response = await getImage(
      imageRequest("result"),
      routeContext(session.id),
    );
    expect(response.status).toBe(409);
  });

  it.each([null, "", "avatar"])("400s the kind %j", async (kind) => {
    const session = await createSession(imageFile());
    const response = await getImage(
      imageRequest(kind),
      routeContext(session.id),
    );
    expect(response.status).toBe(400);
  });

  it("410s an expired session instead of leaking the photo", async () => {
    const session = await createSession(imageFile());
    await patchMetadata(session.id, { expiresAt: expiredAt() });

    const response = await getImage(
      imageRequest("input"),
      routeContext(session.id),
    );
    expect(response.status).toBe(410);
  });

  it("404s a traversal attempt in the id", async () => {
    const response = await getImage(
      imageRequest("input"),
      routeContext("../../../etc/passwd"),
    );
    expect(response.status).toBe(404);
  });
});

describe("session lifecycle", () => {
  it("moves ready → generating → complete exactly once", async () => {
    rendersSuccessfully();
    const session = await createSession(imageFile());
    expect((await getSession(session.id)).status).toBe("ready");

    await postGenerate(generateRequest(), routeContext(session.id));
    expect((await getSession(session.id)).status).toBe("complete");

    await postGenerate(generateRequest(), routeContext(session.id));
    expect(generateImageMock).toHaveBeenCalledTimes(1);
  });
});

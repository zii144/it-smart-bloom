import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateImage } from "@/lib/generate-image";
import {
  createSession,
  getSession,
  readInputImage,
  readResultImage,
} from "@/lib/sessions";
import { imageFile, jpegBytes, patchMetadata } from "./helpers";

const { editMock } = vi.hoisted(() => ({ editMock: vi.fn() }));

vi.mock("openai", () => {
  class FakeOpenAI {
    images = { edit: editMock };
  }
  return {
    default: FakeOpenAI,
    toFile: vi.fn(async (bytes: Buffer, name: string) => ({ bytes, name })),
  };
});

function pngResponse(payload = "generated-portrait-bytes") {
  return { data: [{ b64_json: Buffer.from(payload).toString("base64") }] };
}

beforeEach(() => {
  editMock.mockReset();
  editMock.mockResolvedValue(pngResponse());
});

describe("generateImage — real render", () => {
  it("marks the session generating, then complete with the returned image", async () => {
    const session = await createSession(imageFile());

    await generateImage(session.id);

    const finished = await getSession(session.id);
    expect(finished.status).toBe("complete");
    expect(finished.resultMime).toBe("image/jpeg");
    expect(finished.generationStartedAt).toBeTruthy();

    const result = await readResultImage(session.id);
    expect(result.bytes.toString()).toBe("generated-portrait-bytes");
  });

  it("sends the configured options and system prompt to OpenAI", async () => {
    process.env.OPENAI_IMAGE_SYSTEM_PROMPT = "watercolour 路老師 portrait";
    const session = await createSession(imageFile());

    await generateImage(session.id, {
      model: "gpt-image-1.5",
      quality: "high",
      size: "1536x1024",
      outputFormat: "webp",
      outputCompression: 70,
    });

    expect(editMock).toHaveBeenCalledTimes(1);
    expect(editMock.mock.calls[0][0]).toMatchObject({
      model: "gpt-image-1.5",
      quality: "high",
      size: "1536x1024",
      output_format: "webp",
      output_compression: 70,
      prompt: "watercolour 路老師 portrait",
      n: 1,
    });
  });

  it("omits compression for png, which does not support it", async () => {
    const session = await createSession(imageFile());
    await generateImage(session.id, { outputFormat: "png" });

    expect(editMock.mock.calls[0][0].output_compression).toBeUndefined();
  });

  it("deduplicates concurrent requests for the same session", async () => {
    const session = await createSession(imageFile());

    await Promise.all([
      generateImage(session.id),
      generateImage(session.id),
      generateImage(session.id),
    ]);

    expect(editMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-render a session that is already complete", async () => {
    const session = await createSession(imageFile());
    await generateImage(session.id);
    expect(editMock).toHaveBeenCalledTimes(1);

    await generateImage(session.id);
    expect(editMock).toHaveBeenCalledTimes(1);
  });

  it("joins an in-flight render rather than starting a second billable one", async () => {
    const session = await createSession(imageFile());
    let finishEdit!: (value: unknown) => void;
    editMock.mockReturnValue(
      new Promise((resolve) => {
        finishEdit = resolve;
      }),
    );

    const first = generateImage(session.id);
    await vi.waitFor(() => expect(editMock).toHaveBeenCalledTimes(1));

    // The guest taps retry while the first render is still running.
    const forced = generateImage(session.id, null, true);
    finishEdit(pngResponse());
    await Promise.all([first, forced]);

    expect(editMock).toHaveBeenCalledTimes(1);
  });

  it("re-renders a completed session when forced", async () => {
    const session = await createSession(imageFile());
    await generateImage(session.id);

    editMock.mockResolvedValue(pngResponse("second-take"));
    await generateImage(session.id, null, true);

    expect(editMock).toHaveBeenCalledTimes(2);
    expect((await readResultImage(session.id)).bytes.toString()).toBe(
      "second-take",
    );
  });
});

describe("generateImage — failures", () => {
  it("records the failure on the session and rethrows", async () => {
    editMock.mockRejectedValue(new Error("OpenAI is down"));
    const session = await createSession(imageFile());

    await expect(generateImage(session.id)).rejects.toThrow("OpenAI is down");

    const failed = await getSession(session.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("OpenAI is down");
  });

  it("fails when OpenAI returns no image payload", async () => {
    editMock.mockResolvedValue({ data: [] });
    const session = await createSession(imageFile());

    await expect(generateImage(session.id)).rejects.toThrow(/未回傳圖片/);
    expect((await getSession(session.id)).status).toBe("failed");
  });

  it.each(["OPENAI_API_KEY", "OPENAI_IMAGE_SYSTEM_PROMPT"])(
    "fails clearly when %s is missing",
    async (key) => {
      delete process.env[key];
      const session = await createSession(imageFile());

      await expect(generateImage(session.id)).rejects.toThrow(key);
      expect(editMock).not.toHaveBeenCalled();
      expect((await getSession(session.id)).status).toBe("failed");
    },
  );

  it("allows a retry after a failure", async () => {
    editMock.mockRejectedValueOnce(new Error("transient"));
    const session = await createSession(imageFile());
    await expect(generateImage(session.id)).rejects.toThrow("transient");

    editMock.mockResolvedValue(pngResponse("recovered"));
    await generateImage(session.id);

    expect((await getSession(session.id)).status).toBe("complete");
    expect((await readResultImage(session.id)).bytes.toString()).toBe(
      "recovered",
    );
  });

  it("refuses to render an expired session", async () => {
    const session = await createSession(imageFile());
    await patchMetadata(session.id, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(generateImage(session.id)).rejects.toMatchObject({
      status: 410,
    });
    expect(editMock).not.toHaveBeenCalled();
  });
});

describe("generateImage — fake render", () => {
  it("copies the source photo and never calls OpenAI", async () => {
    process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
    const bytes = jpegBytes(96);
    const session = await createSession(imageFile(bytes));

    await generateImage(session.id, { fakeGenerate: true });

    expect(editMock).not.toHaveBeenCalled();
    const result = await readResultImage(session.id);
    const input = await readInputImage(session.id);
    expect(Buffer.compare(result.bytes, input.bytes)).toBe(0);
    expect((await getSession(session.id)).status).toBe("complete");
  });

  it("is blocked outside development and preview", async () => {
    process.env.VERCEL_ENV = "production";
    const session = await createSession(imageFile());

    await expect(
      generateImage(session.id, { fakeGenerate: true }),
    ).rejects.toThrow(/假生成/);
    expect(editMock).not.toHaveBeenCalled();
  });
});

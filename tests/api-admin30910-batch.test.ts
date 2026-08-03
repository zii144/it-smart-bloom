import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin30910/batch/route";
import { createAdminToken } from "@/lib/admin-auth";
import { imageFile, jpegBytes, readMetadata } from "./helpers";

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

function openAiResponse(payload = "batch-portrait-bytes") {
  return { data: [{ b64_json: Buffer.from(payload).toString("base64") }] };
}

function batchRequest(
  body: FormData,
  { token }: { token?: string } = {},
) {
  return new Request("http://booth.local/api/admin30910/batch", {
    method: "POST",
    body,
    ...(token ? { headers: { cookie: `bloom_admin=${token}` } } : {}),
  });
}

function formWith(file = imageFile(), imageOptions?: unknown) {
  const body = new FormData();
  body.append("image", file);
  if (imageOptions !== undefined) {
    body.append(
      "imageOptions",
      typeof imageOptions === "string"
        ? imageOptions
        : JSON.stringify(imageOptions),
    );
  }
  return body;
}

beforeEach(() => {
  delete process.env.ADMIN_DASHBOARD_SECRET;
  editMock.mockReset();
  editMock.mockResolvedValue(openAiResponse());
});

describe("POST /api/admin30910/batch — access", () => {
  it("returns 404 when the dashboard secret is unset", async () => {
    const response = await POST(batchRequest(formWith()));

    expect(response.status).toBe(404);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("returns 401 without credentials", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";

    const response = await POST(batchRequest(formWith()));

    expect(response.status).toBe(401);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("returns 400 when no photo is attached", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";

    const response = await POST(
      batchRequest(new FormData(), { token: createAdminToken() }),
    );

    expect(response.status).toBe(400);
    expect(editMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/admin30910/batch — generation", () => {
  beforeEach(() => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  });

  it("renders with the env system prompt and returns admin image URLs", async () => {
    process.env.OPENAI_IMAGE_SYSTEM_PROMPT = "watercolour 路老師 portrait";

    const response = await POST(
      batchRequest(formWith(imageFile(jpegBytes(96))), {
        token: createAdminToken(),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      status: "complete",
      resultMime: "image/jpeg",
      error: null,
    });
    expect(payload.inputUrl).toBe(
      `/api/admin30910/sessions/${payload.id}/image?kind=input`,
    );
    expect(payload.resultUrl).toBe(
      `/api/admin30910/sessions/${payload.id}/image?kind=result`,
    );
    expect(editMock).toHaveBeenCalledTimes(1);
    expect(editMock.mock.calls[0][0]).toMatchObject({
      prompt: "watercolour 路老師 portrait",
      n: 1,
    });
  });

  it("tags the session as admin-batch so the dashboard can tell it apart", async () => {
    const response = await POST(
      batchRequest(formWith(), { token: createAdminToken() }),
    );

    const { id } = await response.json();
    expect((await readMetadata(id)).source).toBe("admin-batch");
  });

  it("falls back to the env image options when none are sent", async () => {
    process.env.OPENAI_IMAGE_MODEL = "gpt-image-1.5";
    process.env.OPENAI_IMAGE_QUALITY = "high";
    process.env.OPENAI_IMAGE_SIZE = "1024x1536";

    await POST(batchRequest(formWith(), { token: createAdminToken() }));

    expect(editMock.mock.calls[0][0]).toMatchObject({
      model: "gpt-image-1.5",
      quality: "high",
      size: "1024x1536",
    });
  });

  it("honours per-batch overrides", async () => {
    await POST(
      batchRequest(
        formWith(imageFile(), {
          model: "gpt-image-1",
          quality: "low",
          size: "1536x1024",
        }),
        { token: createAdminToken() },
      ),
    );

    expect(editMock.mock.calls[0][0]).toMatchObject({
      model: "gpt-image-1",
      quality: "low",
      size: "1536x1024",
    });
  });

  it("returns 400 for an unsupported option instead of billing OpenAI", async () => {
    const response = await POST(
      batchRequest(formWith(imageFile(), { model: "dall-e-2" }), {
        token: createAdminToken(),
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/不支援/);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("rejects a non-image upload", async () => {
    const body = new FormData();
    body.append("image", new File(["not-an-image"], "notes.txt", {
      type: "text/plain",
    }));

    const response = await POST(
      batchRequest(body, { token: createAdminToken() }),
    );

    expect(response.status).toBe(415);
    expect(editMock).not.toHaveBeenCalled();
  });

  it("surfaces the real failure reason to the admin", async () => {
    editMock.mockRejectedValue(new Error("OpenAI rate limit reached"));

    const response = await POST(
      batchRequest(formWith(), { token: createAdminToken() }),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("OpenAI rate limit reached");
  });

  it("reports the missing system prompt without calling OpenAI", async () => {
    delete process.env.OPENAI_IMAGE_SYSTEM_PROMPT;

    const response = await POST(
      batchRequest(formWith(), { token: createAdminToken() }),
    );

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(
      /OPENAI_IMAGE_SYSTEM_PROMPT/,
    );
    expect(editMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/sessions/route";
import {
  PhotoAlreadySubmittedError,
  PhotoSubmissionsClosedError,
  RosterUnavailableError,
} from "@/lib/roster-store";
import { getSession } from "@/lib/sessions";
import { imageFile, jpegBytes } from "./helpers";

const {
  afterMock,
  generateImageMock,
  findRosterMatchMock,
  reserveMock,
  releaseMock,
  assertOpenMock,
} = vi.hoisted(() => ({
  afterMock: vi.fn(),
  generateImageMock: vi.fn(),
  findRosterMatchMock: vi.fn(),
  reserveMock: vi.fn(),
  releaseMock: vi.fn(),
  assertOpenMock: vi.fn(),
}));

vi.mock("next/server", () => ({ after: afterMock }));
vi.mock("@/lib/generate-image", () => ({ generateImage: generateImageMock }));
vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  findRosterMatch: findRosterMatchMock,
  reservePhotoSubmission: reserveMock,
  releasePhotoSubmission: releaseMock,
  assertPhotoSubmissionsOpen: assertOpenMock,
}));

const GUEST = { name: "張小明", phone: "0912345678" };

/** Run the work the route handed to `after()`, the way the server would. */
async function flushAfterCallbacks() {
  for (const [callback] of afterMock.mock.calls) {
    await callback();
  }
}

function createRequest(
  file = imageFile(),
  imageOptions?: string,
  extraFields: Record<string, string> = GUEST,
) {
  const body = new FormData();
  body.set("image", file);
  if (imageOptions !== undefined) {
    body.set("imageOptions", imageOptions);
  }
  for (const [key, value] of Object.entries(extraFields)) {
    body.set(key, value);
  }
  return new Request("http://booth.local/api/sessions", {
    method: "POST",
    body,
  });
}

beforeEach(() => {
  afterMock.mockReset();
  generateImageMock.mockReset();
  generateImageMock.mockResolvedValue(undefined);
  findRosterMatchMock.mockReset();
  findRosterMatchMock.mockResolvedValue({ id: "roster-1" });
  reserveMock.mockReset();
  reserveMock.mockResolvedValue("2026-11-10T06:00:00.000Z");
  releaseMock.mockReset();
  releaseMock.mockResolvedValue(undefined);
  assertOpenMock.mockReset();
  assertOpenMock.mockResolvedValue(undefined);
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

  it("links the portrait to the guest's roster entry, not their details", async () => {
    const response = await POST(
      createRequest(imageFile(), undefined, {
        ...GUEST,
        phone: "0912-345-678",
        lineId: "112-張小明-南投縣",
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(findRosterMatchMock).toHaveBeenCalledWith("張小明", "0912345678");
    expect(payload).not.toHaveProperty("identity");
    expect(payload).not.toHaveProperty("rosterEntryId");
    const session = await getSession(payload.id);
    expect(session.rosterEntryId).toBe("roster-1");
    expect(session.identity).toBeUndefined();
    expect(JSON.stringify(session)).not.toContain("0912345678");
    expect(JSON.stringify(session)).not.toContain("張小明");
  });

  it("claims the guest's one photo submission and keeps it on success", async () => {
    const response = await POST(createRequest());

    expect(response.status).toBe(201);
    expect(reserveMock).toHaveBeenCalledWith("roster-1");
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("refuses a second photo from the same guest before storing anything", async () => {
    reserveMock.mockRejectedValue(new PhotoAlreadySubmittedError());

    const response = await POST(createRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      alreadySubmitted: true,
      error: expect.stringContaining("每位來賓限一次"),
    });
    expect(afterMock).not.toHaveBeenCalled();
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("gives the submission back when the photo cannot be stored", async () => {
    const response = await POST(createRequest(imageFile(jpegBytes(13 * 1024 * 1024))));

    expect(response.status).toBe(413);
    expect(releaseMock).toHaveBeenCalledWith("roster-1", "2026-11-10T06:00:00.000Z");
  });

  it("refuses a guest who is not on the roster before storing anything", async () => {
    findRosterMatchMock.mockResolvedValue(null);

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("找不到");
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("refuses every guest once an admin closes submissions", async () => {
    assertOpenMock.mockRejectedValue(new PhotoSubmissionsClosedError());

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      closed: true,
      error: "提交個人照片，製作專屬小禮已截止收件。",
    });
    expect(findRosterMatchMock).not.toHaveBeenCalled();
    expect(reserveMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("requires a name and phone", async () => {
    const response = await POST(createRequest(imageFile(), undefined, {}));

    expect(response.status).toBe(400);
    expect(findRosterMatchMock).not.toHaveBeenCalled();
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("fails closed when the roster cannot be read", async () => {
    findRosterMatchMock.mockRejectedValue(new RosterUnavailableError());

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
    expect(afterMock).not.toHaveBeenCalled();
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

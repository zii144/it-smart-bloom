import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin30910/roster/[id]/regenerate/route";
import { createAdminToken } from "@/lib/admin-auth";
import { SpendLimitError } from "@/lib/image-spend";
import { RosterNotFoundError } from "@/lib/roster-store";
import { createSession, updateSession } from "@/lib/sessions";
import { imageFile, routeContext } from "./helpers";

const mocks = vi.hoisted(() => ({ readFailed: vi.fn(), generate: vi.fn() }));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  readRosterFailedPortraitSession: mocks.readFailed,
}));

vi.mock("@/lib/generate-image", () => ({ generateImage: mocks.generate }));

function request({ admin = true, origin }: { admin?: boolean; origin?: string } = {}) {
  const headers = new Headers();
  if (admin) headers.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (origin) headers.set("origin", origin);
  return new Request("http://booth.local/api/admin30910/roster/abc123/regenerate", {
    method: "POST",
    headers,
  });
}

let sessionId: string;

beforeEach(async () => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  mocks.readFailed.mockReset();
  mocks.generate.mockReset();
  const session = await createSession(imageFile(), {
    model: "gpt-image-2",
    quality: "medium",
    size: "1024x1024",
    outputFormat: "jpeg",
  } as never);
  await updateSession(session.id, { status: "failed", error: "429 no credits" });
  sessionId = session.id;
  mocks.readFailed.mockResolvedValue(sessionId);
  mocks.generate.mockImplementation(async (id: string) => {
    await updateSession(id, { status: "complete", resultMime: "image/jpeg" });
  });
});

describe("POST /api/admin30910/roster/:id/regenerate", () => {
  it("re-runs the guest's failed session as an admin, with the booth's options", async () => {
    const response = await POST(request(), routeContext("abc123"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ portraitStatus: "complete" });
    expect(mocks.generate).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ model: "gpt-image-2" }),
      false,
      { asAdmin: true },
    );
  });

  it("refuses guests with nothing failed to retry", async () => {
    mocks.readFailed.mockResolvedValue(null);
    const response = await POST(request(), routeContext("abc123"));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("不需要重新生成");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("explains an empty OpenAI account plainly", async () => {
    mocks.generate.mockRejectedValue(
      new Error("429 You have no credits remaining. Add credits to continue."),
    );
    const response = await POST(request(), routeContext("abc123"));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("OpenAI 額度不足，請先儲值後再重新生成。");
  });

  it("names a revoked or wrong API key", async () => {
    mocks.generate.mockRejectedValue(
      new Error("401 Incorrect API key provided: sk-proj-****abcd."),
    );
    const response = await POST(request(), routeContext("abc123"));
    expect((await response.json()).error).toBe("OpenAI API 金鑰無效，請確認伺服器的 OPENAI_API_KEY。");
  });

  it("passes the daily ceiling and the try cap through", async () => {
    mocks.generate.mockRejectedValueOnce(new SpendLimitError("今日生成已達上限。"));
    expect((await POST(request(), routeContext("abc123"))).status).toBe(429);
  });

  it("is admin-only, same-origin, and 404s unknown guests", async () => {
    expect((await POST(request({ admin: false }), routeContext("abc123"))).status).toBe(401);
    expect(
      (await POST(request({ origin: "https://evil.example" }), routeContext("abc123"))).status,
    ).toBe(403);
    expect((await POST(request(), routeContext("../x"))).status).toBe(404);
    mocks.readFailed.mockRejectedValue(new RosterNotFoundError());
    expect((await POST(request(), routeContext("missing"))).status).toBe(404);
    expect(mocks.generate).not.toHaveBeenCalled();
  });
});

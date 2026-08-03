import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/dev/set-avatar/route";
import { jpegBytes } from "./helpers";

const ORIGIN = "http://localhost:3059";

function stubRequest(options: {
  token?: string | null;
  portraitUrl?: string;
  body?: BodyInit | null;
}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.token !== null) {
    headers.Authorization = `Bearer ${options.token ?? "mock-rt-idtoken-x"}`;
  }
  return new Request(`${ORIGIN}/api/dev/set-avatar`, {
    method: "POST",
    headers,
    body:
      options.body !== undefined
        ? options.body
        : JSON.stringify({
            portraitUrl:
              options.portraitUrl ?? `${ORIGIN}/api/sessions/abc/image?kind=result`,
            sessionId: "abc",
          }),
  });
}

function stubUpstream(response: Response | (() => Promise<Response>)) {
  const fetchMock = vi.fn(
    typeof response === "function" ? response : async () => response,
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_IMAGE_TUNING = "true";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/dev/set-avatar", () => {
  it("hides itself outside the tuning environments", async () => {
    delete process.env.NEXT_PUBLIC_IMAGE_TUNING;
    const response = await POST(stubRequest({}));
    expect(response.status).toBe(404);
  });

  it("requires a bearer token like the real function", async () => {
    const response = await POST(stubRequest({ token: null }));
    expect(response.status).toBe(401);
  });

  it("rejects an empty bearer token", async () => {
    const response = await POST(stubRequest({ token: "" }));
    expect(response.status).toBe(401);
  });

  it("pins the portrait host to its own origin", async () => {
    const upstream = stubUpstream(new Response("nope"));
    const response = await POST(
      stubRequest({ portraitUrl: "https://evil.example/steal" }),
    );
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects an unparsable portraitUrl body", async () => {
    const response = await POST(stubRequest({ body: "not json" }));
    expect(response.status).toBe(400);
  });

  it("accepts a same-origin portrait and reports itself as a mock", async () => {
    stubUpstream(
      new Response(new Uint8Array(jpegBytes()), {
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    const response = await POST(stubRequest({}));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; mock: boolean };
    expect(payload.ok).toBe(true);
    // The client shows an honest "simulated" message off this flag.
    expect(payload.mock).toBe(true);
  });

  it("relays a missing portrait as 502", async () => {
    stubUpstream(new Response("gone", { status: 404 }));
    const response = await POST(stubRequest({}));
    expect(response.status).toBe(502);
  });

  it("rejects non-image content", async () => {
    stubUpstream(
      new Response("{}", { headers: { "Content-Type": "application/json" } }),
    );
    const response = await POST(stubRequest({}));
    expect(response.status).toBe(415);
  });

  it("rejects an empty image body", async () => {
    stubUpstream(
      new Response(new Uint8Array(0), {
        headers: { "Content-Type": "image/jpeg" },
      }),
    );
    const response = await POST(stubRequest({}));
    expect(response.status).toBe(413);
  });
});

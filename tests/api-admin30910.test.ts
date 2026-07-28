import { beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/admin30910/route";
import { GET as getAdminImage } from "@/app/api/admin30910/sessions/[id]/image/route";
import { createAdminToken } from "@/lib/admin-auth";
import { createSession, writeResultImage } from "@/lib/sessions";
import { imageFile, jpegBytes, routeContext } from "./helpers";

beforeEach(() => {
  delete process.env.ADMIN_DASHBOARD_SECRET;
});

describe("GET /api/admin30910", () => {
  it("returns 404 when the dashboard secret is unset", async () => {
    const response = await GET(
      new Request("http://booth.local/api/admin30910"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 401 without credentials", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const response = await GET(
      new Request("http://booth.local/api/admin30910"),
    );
    expect(response.status).toBe(401);
  });

  it("returns health and session lists when authorized", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const session = await createSession(imageFile());
    await writeResultImage(session.id, jpegBytes(), "image/jpeg");
    const token = createAdminToken();

    const response = await GET(
      new Request("http://booth.local/api/admin30910", {
        headers: { cookie: `bloom_admin=${token}` },
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.health).toMatchObject({
      hasOpenAiKey: true,
      dataDir: expect.any(String),
    });

    const localRow = payload.localSessions.find(
      (row: { id: string }) => row.id === session.id,
    );
    expect(localRow).toMatchObject({
      id: session.id,
      status: "complete",
      inputUrl: `/api/sessions/${session.id}/image?kind=input`,
      resultUrl: `/api/sessions/${session.id}/image?kind=result`,
    });
    expect(Array.isArray(payload.archiveSessions)).toBe(true);
  });

  it("omits resultUrl for incomplete local sessions", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const session = await createSession(imageFile());
    const token = createAdminToken();

    const response = await GET(
      new Request("http://booth.local/api/admin30910", {
        headers: { cookie: `bloom_admin=${token}` },
      }),
    );

    const localRow = (await response.json()).localSessions.find(
      (row: { id: string }) => row.id === session.id,
    );
    expect(localRow).toMatchObject({
      inputUrl: `/api/sessions/${session.id}/image?kind=input`,
      resultUrl: null,
    });
  });
});

describe("GET /api/admin30910/sessions/[id]/image", () => {
  it("returns 401 without credentials", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const session = await createSession(imageFile());

    const response = await getAdminImage(
      new Request(
        `http://booth.local/api/admin30910/sessions/${session.id}/image?kind=input`,
      ),
      routeContext(session.id),
    );

    expect(response.status).toBe(401);
  });

  it("serves a local input image when authorized with cookie", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const bytes = jpegBytes(128);
    const session = await createSession(imageFile(bytes));
    const token = createAdminToken();

    const response = await getAdminImage(
      new Request(
        `http://booth.local/api/admin30910/sessions/${session.id}/image?kind=input`,
        { headers: { cookie: `bloom_admin=${token}` } },
      ),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("serves a local result image when the session is complete", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const session = await createSession(imageFile());
    const result = jpegBytes(96);
    await writeResultImage(session.id, result, "image/jpeg");
    const token = createAdminToken();

    const response = await getAdminImage(
      new Request(
        `http://booth.local/api/admin30910/sessions/${session.id}/image?kind=result`,
        { headers: { cookie: `bloom_admin=${token}` } },
      ),
      routeContext(session.id),
    );

    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(result);
  });

  it("returns 400 for an invalid kind", async () => {
    process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
    const session = await createSession(imageFile());
    const token = createAdminToken();

    const response = await getAdminImage(
      new Request(
        `http://booth.local/api/admin30910/sessions/${session.id}/image?kind=thumb`,
        { headers: { cookie: `bloom_admin=${token}` } },
      ),
      routeContext(session.id),
    );

    expect(response.status).toBe(400);
  });
});

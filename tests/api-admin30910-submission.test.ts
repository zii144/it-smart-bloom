import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE } from "@/app/api/admin30910/roster/[id]/submission/route";
import { createAdminToken } from "@/lib/admin-auth";
import { RosterNotFoundError } from "@/lib/roster-store";
import { routeContext } from "./helpers";

const { allowMock } = vi.hoisted(() => ({ allowMock: vi.fn() }));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  allowPhotoResubmission: allowMock,
}));

const URL = "http://booth.local/api/admin30910/roster/abc123/submission";

function request({ admin = true, origin }: { admin?: boolean; origin?: string } = {}) {
  const headers = new Headers();
  if (admin) headers.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (origin) headers.set("origin", origin);
  return new Request(URL, { method: "DELETE", headers });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  allowMock.mockReset();
  allowMock.mockResolvedValue(undefined);
});

describe("DELETE /api/admin30910/roster/:id/submission", () => {
  it("lets an admin allow one more photo", async () => {
    const response = await DELETE(request(), routeContext("abc123"));
    expect(response.status).toBe(200);
    expect(allowMock).toHaveBeenCalledWith("abc123");
  });

  it("is admin-only and same-origin", async () => {
    expect((await DELETE(request({ admin: false }), routeContext("abc123"))).status).toBe(401);
    expect(
      (await DELETE(request({ origin: "https://evil.example" }), routeContext("abc123"))).status,
    ).toBe(403);
    expect(allowMock).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown or path-like ids", async () => {
    allowMock.mockRejectedValue(new RosterNotFoundError());
    expect((await DELETE(request(), routeContext("missing"))).status).toBe(404);
    expect((await DELETE(request(), routeContext("../x"))).status).toBe(404);
  });
});

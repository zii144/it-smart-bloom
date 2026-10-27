import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getBackup } from "@/app/api/admin30910/reset/backup/route";
import { GET as getPreview, POST as postReset } from "@/app/api/admin30910/reset/route";
import { createAdminToken } from "@/lib/admin-auth";
import { parseResetCategories, parseResetRequest } from "@/lib/data-reset";
import { RosterInputError } from "@/lib/roster";

const lib = vi.hoisted(() => ({
  readResetPreview: vi.fn(),
  resetData: vi.fn(),
  buildResetBackup: vi.fn(),
}));

vi.mock("@/lib/data-reset", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-reset")>()),
  ...lib,
}));

const BASE = "http://booth.local/api/admin30910/reset";

function request(
  url: string,
  init: RequestInit & { admin?: boolean; origin?: string } = {},
) {
  const headers = new Headers(init.headers);
  if (init.admin !== false) headers.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(url, { ...init, headers });
}

function resetRequest(body: unknown, options: { admin?: boolean; origin?: string } = {}) {
  return request(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...options,
  });
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  for (const mock of Object.values(lib)) mock.mockReset();
  lib.resetData.mockImplementation(async (categories: string[]) => ({
    at: "2026-10-27T00:00:00.000Z",
    categories,
    counts: {},
    environment: "emulator",
  }));
});

describe("reset input", () => {
  it("accepts known categories from a list or a comma string", () => {
    expect(parseResetCategories(["roster", "usage", "roster"])).toEqual(["roster", "usage"]);
    expect(parseResetCategories("checkIns, portraits")).toEqual(["checkIns", "portraits"]);
  });

  it.each([[[]], [""], [["everything"]], [null]])("rejects %j", (raw) => {
    expect(() => parseResetCategories(raw)).toThrow(RosterInputError);
  });

  it("insists on the exact confirmation phrase", () => {
    expect(parseResetRequest({ categories: ["usage"], confirmation: "確認重置" })).toEqual(["usage"]);
    for (const confirmation of [undefined, "", "確認", "確認重置 ", "yes"]) {
      expect(() => parseResetRequest({ categories: ["usage"], confirmation })).toThrow(
        /確認重置/,
      );
    }
  });
});

describe("POST /api/admin30910/reset", () => {
  it("resets only with the typed phrase", async () => {
    const response = await postReset(
      resetRequest({ categories: ["checkIns", "usage"], confirmation: "確認重置" }),
    );
    expect(response.status).toBe(200);
    expect(lib.resetData).toHaveBeenCalledWith(["checkIns", "usage"]);
  });

  it("refuses a missing or wrong phrase without touching anything", async () => {
    const response = await postReset(resetRequest({ categories: ["roster"] }));
    expect(response.status).toBe(400);
    expect(lib.resetData).not.toHaveBeenCalled();
  });

  it("is admin-only and same-origin", async () => {
    const body = { categories: ["roster"], confirmation: "確認重置" };
    expect((await postReset(resetRequest(body, { admin: false }))).status).toBe(401);
    expect(
      (await postReset(resetRequest(body, { origin: "https://evil.example" }))).status,
    ).toBe(403);
    const signedIn = resetRequest(body);
    delete process.env.ADMIN_DASHBOARD_SECRET;
    expect((await postReset(signedIn)).status).toBe(404);
    expect(lib.resetData).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin30910/reset", () => {
  it("returns the preview to admins only", async () => {
    lib.readResetPreview.mockResolvedValue({ environment: "live", counts: {}, lastReset: null });
    expect((await getPreview(request(BASE))).status).toBe(200);
    expect((await getPreview(request(BASE, { admin: false }))).status).toBe(401);
  });
});

describe("GET /api/admin30910/reset/backup", () => {
  it("downloads a JSON backup of the chosen categories", async () => {
    lib.buildResetBackup.mockResolvedValue({
      kind: "zhisheng-bloom-backup",
      createdAt: "2026-10-27T01:02:03.456Z",
      collections: { roster: [] },
    });

    const response = await getBackup(request(`${BASE}/backup?categories=roster,usage`));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="bloom-backup-2026-10-27T01-02-03-456Z.json"',
    );
    expect(lib.buildResetBackup).toHaveBeenCalledWith(["roster", "usage"]);
  });

  it("validates categories and requires admin", async () => {
    expect((await getBackup(request(`${BASE}/backup?categories=nope`))).status).toBe(400);
    expect((await getBackup(request(`${BASE}/backup?categories=roster`, { admin: false }))).status).toBe(401);
    expect(lib.buildResetBackup).not.toHaveBeenCalled();
  });
});

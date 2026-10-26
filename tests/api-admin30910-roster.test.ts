import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin30910/roster/route";
import { DELETE, PATCH } from "@/app/api/admin30910/roster/[id]/route";
import { POST as importRoster } from "@/app/api/admin30910/roster/import/route";
import { createAdminToken } from "@/lib/admin-auth";
import { planRosterImport, type ParsedRoster } from "@/lib/roster";
import {
  RosterConflictError,
  RosterNotFoundError,
  RosterUnavailableError,
} from "@/lib/roster-store";
import { routeContext } from "./helpers";
import { buildXlsx, ROSTER_HEADER, rosterRow, xlsxFile } from "./xlsx-fixture";

const store = vi.hoisted(() => ({
  listRosterEntries: vi.fn(),
  readLastImport: vi.fn(),
  createRosterEntry: vi.fn(),
  updateRosterEntry: vi.fn(),
  deleteRosterEntry: vi.fn(),
  previewRosterImport: vi.fn(),
  applyRosterImport: vi.fn(),
}));

vi.mock("@/lib/roster-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/roster-store")>()),
  ...store,
}));

const BASE = "http://booth.local/api/admin30910/roster";

function adminRequest(
  url: string,
  init: RequestInit & { origin?: string } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cookie", `bloom_admin=${createAdminToken()}`);
  if (init.origin) headers.set("origin", init.origin);
  return new Request(url, { ...init, headers });
}

function jsonRequest(url: string, method: string, body: unknown, origin?: string) {
  return adminRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    origin,
  });
}

function importRequest(file: File, mode: string) {
  const body = new FormData();
  body.set("file", file);
  body.set("mode", mode);
  return adminRequest(`${BASE}/import`, { method: "POST", body });
}

function rosterWorkbook() {
  return xlsxFile(
    buildXlsx([
      {
        name: "成果展名單合併版",
        rows: [
          ROSTER_HEADER,
          rosterRow({ 座位: "A1", 姓名: "甲", 手機: "0911111111", 地址: "某市某路 1 號" }),
          rosterRow({ 座位: "A2", 姓名: "乙", 手機: null }),
          rosterRow({ 座位: "A3", 姓名: "甲", 手機: "0911111111" }),
        ],
      },
    ]),
  );
}

beforeEach(() => {
  process.env.ADMIN_DASHBOARD_SECRET = "s3cret";
  for (const mock of Object.values(store)) mock.mockReset();
  store.listRosterEntries.mockResolvedValue([]);
  store.readLastImport.mockResolvedValue(null);
  store.previewRosterImport.mockImplementation(async (parsed: ParsedRoster) =>
    planRosterImport(parsed, []),
  );
  store.applyRosterImport.mockImplementation(async (parsed: ParsedRoster) =>
    planRosterImport(parsed, []),
  );
});

describe("admin roster auth", () => {
  it("is invisible when the dashboard is disabled", async () => {
    delete process.env.ADMIN_DASHBOARD_SECRET;
    expect((await GET(new Request(BASE))).status).toBe(404);
  });

  it("requires admin credentials for every route", async () => {
    const anonymous = (method: string, url = BASE) =>
      new Request(url, { method, body: method === "GET" ? undefined : "{}" });

    expect((await GET(anonymous("GET"))).status).toBe(401);
    expect((await POST(anonymous("POST"))).status).toBe(401);
    expect((await PATCH(anonymous("PATCH", `${BASE}/abc`), routeContext("abc"))).status).toBe(401);
    expect((await DELETE(anonymous("DELETE", `${BASE}/abc`), routeContext("abc"))).status).toBe(401);
    expect((await importRoster(anonymous("POST", `${BASE}/import`))).status).toBe(401);
    expect(store.createRosterEntry).not.toHaveBeenCalled();
    expect(store.deleteRosterEntry).not.toHaveBeenCalled();
  });

  it("refuses writes from another origin even with the admin cookie", async () => {
    const response = await POST(
      jsonRequest(BASE, "POST", { name: "甲" }, "https://evil.example"),
    );
    expect(response.status).toBe(403);
    expect(store.createRosterEntry).not.toHaveBeenCalled();
  });

  it("allows same-origin writes", async () => {
    store.createRosterEntry.mockResolvedValue({ id: "new", name: "甲" });
    const response = await POST(
      jsonRequest(BASE, "POST", { name: "甲" }, "http://booth.local"),
    );
    expect(response.status).toBe(201);
  });
});

describe("GET /api/admin30910/roster", () => {
  it("lists entries with the last import", async () => {
    store.listRosterEntries.mockResolvedValue([{ id: "a", name: "甲" }]);
    store.readLastImport.mockResolvedValue({ importedAt: "2026-10-26T00:00:00.000Z" });

    const response = await GET(adminRequest(BASE));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      entries: [{ id: "a", name: "甲" }],
      lastImport: { importedAt: "2026-10-26T00:00:00.000Z" },
    });
  });

  it("explains when Firebase is not connected", async () => {
    store.listRosterEntries.mockRejectedValue(new RosterUnavailableError());
    const response = await GET(adminRequest(BASE));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("Firebase");
  });
});

describe("POST /api/admin30910/roster", () => {
  it("validates and normalizes before saving", async () => {
    store.createRosterEntry.mockImplementation(async (input) => ({ id: "new", ...input }));

    const response = await POST(
      jsonRequest(BASE, "POST", { name: " 甲 ", mobile: "0911-111-111", seat: "B1" }),
    );

    expect(response.status).toBe(201);
    expect(store.createRosterEntry).toHaveBeenCalledWith(
      expect.objectContaining({ name: "甲", mobile: "0911111111", seat: "B1" }),
    );
  });

  it("rejects invalid input without touching Firestore", async () => {
    const response = await POST(jsonRequest(BASE, "POST", { name: "甲", mobile: "123" }));
    expect(response.status).toBe(400);
    expect(store.createRosterEntry).not.toHaveBeenCalled();
  });

  it("reports a duplicate name + mobile as 409", async () => {
    store.createRosterEntry.mockRejectedValue(new RosterConflictError());
    const response = await POST(jsonRequest(BASE, "POST", { name: "甲", mobile: "0911111111" }));
    expect(response.status).toBe(409);
  });
});

describe("PATCH / DELETE /api/admin30910/roster/:id", () => {
  it("updates an entry", async () => {
    store.updateRosterEntry.mockImplementation(async (id, input) => ({ id, ...input }));

    const response = await PATCH(
      jsonRequest(`${BASE}/abc123`, "PATCH", { name: "甲", mobile: "", note: "改過" }),
      routeContext("abc123"),
    );

    expect(response.status).toBe(200);
    expect(store.updateRosterEntry).toHaveBeenCalledWith(
      "abc123",
      expect.objectContaining({ name: "甲", mobile: null, note: "改過" }),
    );
  });

  it("returns 404 for unknown or path-like ids", async () => {
    store.updateRosterEntry.mockRejectedValue(new RosterNotFoundError());
    expect(
      (await PATCH(jsonRequest(`${BASE}/missing`, "PATCH", { name: "甲" }), routeContext("missing")))
        .status,
    ).toBe(404);

    const response = await DELETE(
      adminRequest(`${BASE}/x`, { method: "DELETE" }),
      routeContext("../sessions"),
    );
    expect(response.status).toBe(404);
    expect(store.deleteRosterEntry).not.toHaveBeenCalled();
  });

  it("deletes an entry", async () => {
    store.deleteRosterEntry.mockResolvedValue(undefined);
    const response = await DELETE(
      adminRequest(`${BASE}/abc123`, { method: "DELETE" }),
      routeContext("abc123"),
    );
    expect(response.status).toBe(200);
    expect(store.deleteRosterEntry).toHaveBeenCalledWith("abc123");
  });
});

describe("POST /api/admin30910/roster/import", () => {
  it("previews without writing", async () => {
    const response = await importRoster(importRequest(rosterWorkbook(), "preview"));
    const summary = await response.json();

    expect(response.status).toBe(200);
    expect(store.previewRosterImport).toHaveBeenCalledTimes(1);
    expect(store.applyRosterImport).not.toHaveBeenCalled();
    expect(summary).toMatchObject({
      mode: "preview",
      sheet: "成果展名單合併版",
      creates: [
        { row: 2, name: "甲", mobile: "0911111111", seat: "A1" },
        { row: 3, name: "乙", mobile: null, seat: "A2" },
      ],
      updates: [],
      ignoredColumns: ["身分證正面", "身分證反面", "存摺"],
    });
    expect(summary.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, level: "warning" }),
        expect.objectContaining({ row: 4, message: expect.stringContaining("第 2 列") }),
      ]),
    );
    // The preview only names people; it never echoes addresses or other columns.
    expect(JSON.stringify(summary)).not.toContain("某市某路");
  });

  it("applies when confirmed", async () => {
    const response = await importRoster(importRequest(rosterWorkbook(), "apply"));
    expect(response.status).toBe(200);
    expect((await response.json()).mode).toBe("apply");
    expect(store.applyRosterImport).toHaveBeenCalledTimes(1);
    expect(store.previewRosterImport).not.toHaveBeenCalled();
  });

  it("rejects a missing file, unknown mode and non-xlsx uploads", async () => {
    const noFile = new FormData();
    noFile.set("mode", "preview");
    expect(
      (await importRoster(adminRequest(`${BASE}/import`, { method: "POST", body: noFile }))).status,
    ).toBe(400);
    expect((await importRoster(importRequest(rosterWorkbook(), "delete-all"))).status).toBe(400);
    expect(
      (await importRoster(importRequest(new File(["a,b"], "roster.csv"), "preview"))).status,
    ).toBe(400);
    expect(store.previewRosterImport).not.toHaveBeenCalled();
    expect(store.applyRosterImport).not.toHaveBeenCalled();
  });
});

/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { watchSeatStatus } from "@/lib/seat-status-client";

const live = vi.hoisted(() => ({
  handlers: new Map<string, (snapshot: unknown) => void>(),
  unsubscribe: vi.fn(),
}));
vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  initializeAuth: () => ({}), inMemoryPersistence: {}, signInWithCustomToken: async () => ({}),
}));
vi.mock("firebase/firestore", () => ({
  getFirestore: () => ({}), collection: (_db: unknown, path: string) => path,
  doc: (_db: unknown, path: string, id: string) => `${path}/${id}`,
  onSnapshot: (path: string, _options: unknown, handler: (snapshot: unknown) => void) => {
    live.handlers.set(path, handler);
    return live.unsubscribe;
  },
}));

let stop: (() => void) | undefined;
const snapshot = { entries: [{ id: "one", seat: "A1", checkedInAt: "2026-11-10T05:00:00Z" }], checkIn: { open: true, updatedAt: null }, verifiedAt: "2026-11-10T05:00:00Z" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => { vi.useFakeTimers(); live.handlers.clear(); live.unsubscribe.mockClear(); });
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("falls back to polling, preserves the last data on failure, and recovers", async () => {
  let fail = false;
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/access")) return json({ customToken: null, expiresAt: Date.now() + 60_000 });
    if (fail) throw new Error("network offline");
    return json(snapshot);
  });
  vi.stubGlobal("fetch", fetchMock);
  const update = vi.fn();
  const connection = vi.fn();
  stop = watchSeatStatus(update, connection);
  await vi.advanceTimersByTimeAsync(0);
  expect(update).toHaveBeenLastCalledWith(snapshot);
  expect(connection).toHaveBeenLastCalledWith("polling");
  fail = true;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(connection).toHaveBeenLastCalledWith("offline");
  expect(update).toHaveBeenCalledTimes(1);
  fail = false;
  await vi.advanceTimersByTimeAsync(5_000);
  expect(connection).toHaveBeenLastCalledWith("polling");
  expect(update).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(update).toHaveBeenCalledTimes(2);
});

it("stops polling when the display session expires", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/access")
    ? json({ customToken: null, expiresAt: Date.now() + 6_000 }) : json(snapshot)));
  const update = vi.fn();
  const connection = vi.fn();
  stop = watchSeatStatus(update, connection);
  await vi.advanceTimersByTimeAsync(6_000);
  expect(connection).toHaveBeenLastCalledWith("auth-required");
  const count = update.mock.calls.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(update).toHaveBeenCalledTimes(count);
});

it("ignores a snapshot request that completes after cleanup", async () => {
  let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/access")
    ? json({ customToken: null, expiresAt: Date.now() + 60_000 })
    : new Promise<Response>((done) => { resolve = done; })));
  const update = vi.fn();
  stop = watchSeatStatus(update, vi.fn());
  await vi.advanceTimersByTimeAsync(0);
  stop();
  resolve(json(snapshot));
  await vi.advanceTimersByTimeAsync(0);
  expect(update).not.toHaveBeenCalled();
});

it("publishes only server-confirmed live snapshots and cancels its startup watchdog", async () => {
  const fetchMock = vi.fn(async () => json({
    customToken: "scoped", expiresAt: Date.now() + 60_000,
    firebaseConfig: {}, emulators: { firestore: null, auth: null },
  }));
  vi.stubGlobal("fetch", fetchMock);
  const update = vi.fn();
  const connection = vi.fn();
  stop = watchSeatStatus(update, connection);
  await vi.advanceTimersByTimeAsync(0);
  await vi.waitFor(() => expect(live.handlers.size).toBe(2));
  const entries = live.handlers.get("seatStatus")!;
  const settings = live.handlers.get("seatStatusMeta/checkIn")!;
  entries({ metadata: { fromCache: true }, docs: [] });
  settings({ metadata: { fromCache: true }, data: () => ({ open: false }) });
  expect(update).not.toHaveBeenCalled();
  entries({ metadata: { fromCache: false }, docs: [{ id: "one", data: () => snapshot.entries[0] }] });
  expect(update).not.toHaveBeenCalled();
  settings({ metadata: { fromCache: false }, data: () => snapshot.checkIn });
  expect(connection).toHaveBeenLastCalledWith("live");
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ entries: snapshot.entries, checkIn: snapshot.checkIn }));
  await vi.advanceTimersByTimeAsync(15_000);
  expect(connection).toHaveBeenLastCalledWith("live");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  stop();
  expect(live.unsubscribe).toHaveBeenCalledTimes(2);
});

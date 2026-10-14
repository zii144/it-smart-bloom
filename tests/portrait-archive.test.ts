import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveSessionCreated,
  archiveSessionStatus,
} from "@/lib/portrait-archive";
import type { ImageSession } from "@/lib/sessions";
import { jpegBytes } from "./helpers";

/**
 * A Firestore/Storage double good enough to run the real archive code.
 * Without it `isFirebaseConfigured()` is false under vitest and every line in
 * `archiveSessionCreated` is skipped, which is how this module previously
 * shipped untested.
 */
const fb = vi.hoisted(() => {
  const docs = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, { mime: string; size: number }>();
  const state = { configured: true, uploadFails: false };

  const isUnion = (
    value: unknown,
  ): value is { __arrayUnion: readonly unknown[] } =>
    typeof value === "object" && value !== null && "__arrayUnion" in value;

  function doc(path: string) {
    return {
      async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
        const previous = options?.merge ? (docs.get(path) ?? {}) : {};
        const next: Record<string, unknown> = { ...previous };

        for (const [key, value] of Object.entries(data)) {
          if (isUnion(value)) {
            // Server-side append, exactly like the real arrayUnion: it sees
            // whatever is stored now, not a snapshot the caller read earlier.
            const current = Array.isArray(next[key])
              ? (next[key] as unknown[])
              : [];
            next[key] = [
              ...current,
              ...value.__arrayUnion.filter((v) => !current.includes(v)),
            ];
          } else if (
            key === "storage" &&
            typeof value === "object" &&
            value !== null
          ) {
            // Nested maps merge key by key.
            next[key] = { ...(next[key] as object), ...value };
          } else {
            next[key] = value;
          }
        }

        docs.set(path, next);
      },
      async get() {
        return { data: () => docs.get(path) };
      },
    };
  }

  return { docs, objects, state, doc };
});

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { arrayUnion: (...values: unknown[]) => ({ __arrayUnion: values }) },
}));

vi.mock("@/lib/firebase-admin", () => ({
  isFirebaseConfigured: () => fb.state.configured,
  getDb: () =>
    fb.state.configured
      ? {
          collection: (name: string) => ({
            doc: (id: string) => fb.doc(`${name}/${id}`),
          }),
        }
      : null,
  getBucket: () =>
    fb.state.configured
      ? {
          file: (objectPath: string) => ({
            async save(bytes: Buffer, options: { contentType: string }) {
              if (fb.state.uploadFails) throw new Error("storage unavailable");
              fb.objects.set(objectPath, {
                mime: options.contentType,
                size: bytes.length,
              });
            },
          }),
        }
      : null,
}));

const MOBILE = "0912345678";

function session(overrides: Partial<ImageSession> = {}): ImageSession {
  const createdAt = new Date().toISOString();
  return {
    id: "s".repeat(32),
    createdAt,
    expiresAt: createdAt,
    status: "ready",
    inputMime: "image/jpeg",
    ...overrides,
  };
}

function withIdentity(id: string, value = MOBILE): ImageSession {
  const base = session({ id });
  return {
    ...base,
    identity: { kind: "mobile", value, claimedAt: base.createdAt },
  };
}

const input = { bytes: jpegBytes(128), mime: "image/jpeg" };

beforeEach(() => {
  fb.docs.clear();
  fb.objects.clear();
  fb.state.configured = true;
  fb.state.uploadFails = false;
  process.env.IDENTITY_KEY_SECRET = "test-identity-secret";
});

describe("archiveSessionCreated", () => {
  it("stores exactly one copy of the guest photo", async () => {
    const id = "a".repeat(32);
    const outcome = await archiveSessionCreated(withIdentity(id), input);

    expect(outcome).toEqual({
      archived: true,
      inputStored: true,
      identityIndexed: true,
    });
    // One object, under sessions/ — never a second copy under identities/.
    expect([...fb.objects.keys()]).toEqual([`sessions/${id}/input`]);
  });

  it("indexes the identity under a key that does not contain the number", async () => {
    const id = "b".repeat(32);
    await archiveSessionCreated(withIdentity(id), input);

    const [path, doc] = [...fb.docs.entries()].find(([key]) =>
      key.startsWith("identities/"),
    )!;

    expect(path).toMatch(/^identities\/mobile_[0-9a-f]{64}$/);
    expect(path).not.toContain(MOBILE);
    expect(doc).toMatchObject({ kind: "mobile", sessionIds: [id] });
  });

  // Two tablets, or one guest retaking their photo: a read-then-write would
  // drop whichever capture lost the race.
  it("keeps both sessions when two captures for one number overlap", async () => {
    const first = "c".repeat(32);
    const second = "d".repeat(32);

    await Promise.all([
      archiveSessionCreated(withIdentity(first), input),
      archiveSessionCreated(withIdentity(second), input),
    ]);

    const index = [...fb.docs.entries()].find(([key]) =>
      key.startsWith("identities/"),
    )![1];

    expect(index.sessionIds).toHaveLength(2);
    expect(index.sessionIds).toEqual(expect.arrayContaining([first, second]));
  });

  it("records the same session id only once", async () => {
    const id = "e".repeat(32);
    await archiveSessionCreated(withIdentity(id), input);
    await archiveSessionCreated(withIdentity(id), input);

    const index = [...fb.docs.entries()].find(([key]) =>
      key.startsWith("identities/"),
    )![1];

    expect(index.sessionIds).toEqual([id]);
  });

  // A record that names an identityKey must resolve to a real index document.
  it("leaves identityKey null when the index could not be written", async () => {
    delete process.env.IDENTITY_KEY_SECRET;
    delete process.env.ADMIN_DASHBOARD_SECRET;
    const id = "f".repeat(32);

    const outcome = await archiveSessionCreated(withIdentity(id), input);

    expect(outcome.identityIndexed).toBe(false);
    expect([...fb.docs.keys()]).toEqual([`sessions/${id}`]);

    const record = fb.docs.get(`sessions/${id}`)!;
    expect(record.identityKey).toBeNull();
    // The guest still needs to be reachable, so the number itself is kept.
    expect(record).toMatchObject({
      identityKind: "mobile",
      identityValue: MOBILE,
    });
  });

  it("skips the identity work entirely when no number was given", async () => {
    const id = "g".repeat(32);
    const outcome = await archiveSessionCreated(session({ id }), input);

    expect(outcome.identityIndexed).toBe(false);
    expect([...fb.docs.keys()]).toEqual([`sessions/${id}`]);
    expect(fb.docs.get(`sessions/${id}`)).toMatchObject({
      identityKind: null,
      identityValue: null,
      identityKey: null,
      claimedAt: null,
    });
  });

  it("reports a failed photo upload instead of implying it stored one", async () => {
    fb.state.uploadFails = true;
    const outcome = await archiveSessionCreated(withIdentity("h".repeat(32)), input);

    expect(outcome).toMatchObject({ archived: true, inputStored: false });
  });

  it("does nothing when Firebase is not configured", async () => {
    fb.state.configured = false;
    const outcome = await archiveSessionCreated(withIdentity("i".repeat(32)), input);

    expect(outcome).toEqual({
      archived: false,
      inputStored: false,
      identityIndexed: false,
    });
    expect(fb.docs.size).toBe(0);
  });
});

describe("archiveSessionStatus", () => {
  it("adds the result without disturbing the stored input path", async () => {
    const id = "j".repeat(32);
    await archiveSessionCreated(withIdentity(id), input);

    await archiveSessionStatus(
      { ...withIdentity(id), status: "complete", resultMime: "image/jpeg" },
      { bytes: jpegBytes(64), mime: "image/jpeg" },
    );

    expect(fb.docs.get(`sessions/${id}`)).toMatchObject({
      status: "complete",
      storage: {
        inputPath: `sessions/${id}/input`,
        resultPath: `sessions/${id}/result`,
      },
    });
    // Still no duplicate of either image under identities/.
    expect([...fb.objects.keys()].every((key) => key.startsWith("sessions/"))).toBe(
      true,
    );
  });

  it("keeps a result path that already worked when a re-upload fails", async () => {
    const id = "k".repeat(32);
    const complete: ImageSession = {
      ...withIdentity(id),
      status: "complete",
      resultMime: "image/jpeg",
    };
    await archiveSessionCreated(withIdentity(id), input);
    await archiveSessionStatus(complete, { bytes: jpegBytes(64), mime: "image/jpeg" });

    fb.state.uploadFails = true;
    await archiveSessionStatus(complete, { bytes: jpegBytes(64), mime: "image/jpeg" });

    expect(fb.docs.get(`sessions/${id}`)).toMatchObject({
      storage: { resultPath: `sessions/${id}/result` },
    });
  });
});

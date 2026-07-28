import { afterEach, describe, expect, it, vi } from "vitest";

describe("firebase-admin emulator detection", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_STORAGE_EMULATOR_HOST;
    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  });

  it("treats FIRESTORE_EMULATOR_HOST as emulator mode", async () => {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
    const { isFirebaseEmulator } = await import("@/lib/firebase-admin");
    expect(isFirebaseEmulator()).toBe(true);
  });

  it("stays offline in tests when no credentials and no emulator are set", async () => {
    const { isFirebaseConfigured, isFirebaseEmulator } = await import(
      "@/lib/firebase-admin"
    );
    expect(isFirebaseEmulator()).toBe(false);
    expect(isFirebaseConfigured()).toBe(false);
  });
});

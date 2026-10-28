import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApps: vi.fn(() => [] as { name: string }[]),
  initializeApp: vi.fn(() => ({ name: "road-teacher" })),
  initializeAuth: vi.fn(() => ({ name: "test-auth" })),
  signIn: vi.fn(),
  signOut: vi.fn(async () => {}),
  getIdToken: vi.fn(async () => "rt-token"),
}));
vi.mock("firebase/app", () => ({
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp,
}));
vi.mock("firebase/auth", () => ({
  initializeAuth: mocks.initializeAuth,
  inMemoryPersistence: "memory-only",
  signInWithEmailAndPassword: mocks.signIn,
  signOut: mocks.signOut,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getApps.mockReturnValue([]);
  mocks.signIn.mockResolvedValue({ user: { getIdToken: mocks.getIdToken } });
  mocks.getIdToken.mockResolvedValue("rt-token");
  process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY = "rt-public-key";
  process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN = "rt-test.firebaseapp.com";
  process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID = "rt-test";
  process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL =
    "https://us-central1-rt-test.cloudfunctions.net/bloomSetAvatar";
});

describe("real RT sign-in", () => {
  it("uses a separate named app with memory-only persistence and reuses it", async () => {
    const { signInToRoadTeacher, forgetRoadTeacherSession } =
      await import("@/lib/road-teacher-auth");
    expect(
      await signInToRoadTeacher(" guest@example.com ", "private-password"),
    ).toBe("rt-token");
    expect(mocks.initializeApp).toHaveBeenCalledWith(
      {
        apiKey: "rt-public-key",
        authDomain: "rt-test.firebaseapp.com",
        projectId: "rt-test",
      },
      "road-teacher",
    );
    expect(mocks.initializeAuth).toHaveBeenCalledWith(
      { name: "road-teacher" },
      { persistence: "memory-only" },
    );
    expect(mocks.signIn).toHaveBeenCalledWith(
      { name: "test-auth" },
      "guest@example.com",
      "private-password",
    );
    await forgetRoadTeacherSession();
    await signInToRoadTeacher("guest@example.com", "again");
    expect(mocks.initializeAuth).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("reuses the named RT app without selecting Bloom's default app", async () => {
    mocks.getApps.mockReturnValue([
      { name: "[DEFAULT]" },
      { name: "road-teacher" },
    ]);
    const { signInToRoadTeacher } = await import("@/lib/road-teacher-auth");
    await signInToRoadTeacher("guest@example.com", "password");
    expect(mocks.initializeApp).not.toHaveBeenCalled();
    expect(mocks.initializeAuth).toHaveBeenCalledWith(
      { name: "road-teacher" },
      { persistence: "memory-only" },
    );
  });

  it.each(["sign-in", "token"])(
    "drops the session on %s failure",
    async (stage) => {
      if (stage === "sign-in")
        mocks.signIn.mockRejectedValueOnce({ code: "auth/invalid-credential" });
      else
        mocks.getIdToken.mockRejectedValueOnce({
          code: "auth/network-request-failed",
        });
      const { signInToRoadTeacher } = await import("@/lib/road-teacher-auth");
      await expect(
        signInToRoadTeacher("guest@example.com", "password"),
      ).rejects.toHaveProperty("code");
      expect(mocks.signOut).toHaveBeenCalledTimes(1);
    },
  );

  it("fails before loading the SDK when RT config is incomplete", async () => {
    delete process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID;
    const { signInToRoadTeacher } = await import("@/lib/road-teacher-auth");
    await expect(
      signInToRoadTeacher("guest@example.com", "password"),
    ).rejects.toThrow("尚未開通");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });
});

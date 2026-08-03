import { beforeEach, describe, expect, it } from "vitest";
import {
  authErrorMessage,
  isRoadTeacherMockEnabled,
  signInToRoadTeacher,
} from "@/lib/road-teacher-auth";

describe("road-teacher sign-in — mock provider", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_RT_MOCK = "true";
  });

  it("is disabled unless the flag opts in", async () => {
    delete process.env.NEXT_PUBLIC_RT_MOCK;
    expect(isRoadTeacherMockEnabled()).toBe(false);
    await expect(
      signInToRoadTeacher("guest@example.com", "correct-horse"),
    ).rejects.toThrow("路老師系統尚未開通，請稍後再試。");
  });

  it("resolves with a fake ID token for a valid credential", async () => {
    const token = await signInToRoadTeacher("guest@example.com", "sunny-day");
    expect(token.startsWith("mock-rt-idtoken-")).toBe(true);
  });

  it("rejects the designated wrong password with invalid-credential", async () => {
    await expect(
      signInToRoadTeacher("guest@example.com", "wrong"),
    ).rejects.toMatchObject({ code: "auth/invalid-credential" });
  });

  it("rejects passwords shorter than Firebase's six-char floor", async () => {
    await expect(
      signInToRoadTeacher("guest@example.com", "abc"),
    ).rejects.toMatchObject({ code: "auth/invalid-credential" });
  });

  it("rejects a malformed email", async () => {
    await expect(
      signInToRoadTeacher("not-an-email", "sunny-day"),
    ).rejects.toMatchObject({ code: "auth/invalid-email" });
  });

  it("simulates lockout and disabled accounts via magic prefixes", async () => {
    await expect(
      signInToRoadTeacher("locked@example.com", "sunny-day"),
    ).rejects.toMatchObject({ code: "auth/too-many-requests" });
    await expect(
      signInToRoadTeacher("disabled@example.com", "sunny-day"),
    ).rejects.toMatchObject({ code: "auth/user-disabled" });
  });
});

describe("authErrorMessage", () => {
  it("collapses user-not-found into the wrong-password message", () => {
    // The form must not reveal which accounts exist.
    const wrongPassword = authErrorMessage({ code: "auth/wrong-password" });
    expect(authErrorMessage({ code: "auth/user-not-found" })).toBe(
      wrongPassword,
    );
    expect(authErrorMessage({ code: "auth/invalid-credential" })).toBe(
      wrongPassword,
    );
    expect(wrongPassword).toBe("帳號或密碼不正確。");
  });

  it("maps the remaining auth codes to guest-facing Chinese", () => {
    expect(authErrorMessage({ code: "auth/invalid-email" })).toBe(
      "請輸入有效的電子郵件。",
    );
    expect(authErrorMessage({ code: "auth/too-many-requests" })).toBe(
      "嘗試次數過多，請稍後再試。",
    );
    expect(authErrorMessage({ code: "auth/user-disabled" })).toBe(
      "此帳號已停用，請聯絡路老師系統管理員。",
    );
    expect(authErrorMessage({ code: "auth/network-request-failed" })).toBe(
      "網路連線不穩，請稍後再試。",
    );
  });

  it("falls back generically for unknown auth codes", () => {
    expect(authErrorMessage({ code: "auth/whatever-new" })).toBe(
      "登入失敗，請稍後再試。",
    );
  });

  it("passes through plain Error messages from the avatar endpoint", () => {
    expect(authErrorMessage(new Error("路老師系統回應 502"))).toBe(
      "路老師系統回應 502",
    );
  });

  it("never renders an empty message", () => {
    expect(authErrorMessage(undefined)).toBe("路老師系統暫時無法使用。");
    expect(authErrorMessage(new Error(""))).toBe("路老師系統暫時無法使用。");
  });
});

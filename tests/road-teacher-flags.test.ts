import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  getRoadTeacherConfig,
  isRoadTeacherAvatarUiEnabled,
  isRoadTeacherMockEnabled,
} from "@/lib/road-teacher-flags";

beforeEach(() => {
  process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "true";
  process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY = "public-key";
  process.env.NEXT_PUBLIC_RT_FIREBASE_AUTH_DOMAIN = "rt-test.firebaseapp.com";
  process.env.NEXT_PUBLIC_RT_FIREBASE_PROJECT_ID = "rt-test";
  process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL =
    "https://rt.example/bloomSetAvatar";
});
afterEach(() => vi.unstubAllEnvs());
it("stays hidden by default even when real configuration or mock mode is available", () => {
  delete process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED;
  expect(isRoadTeacherAvatarUiEnabled()).toBe(false);
  process.env.NEXT_PUBLIC_RT_MOCK = "true";
  expect(isRoadTeacherAvatarUiEnabled()).toBe(false);
  process.env.NEXT_PUBLIC_RT_AVATAR_ENABLED = "false";
  expect(isRoadTeacherAvatarUiEnabled()).toBe(false);
});
it("shows real replacement only when the complete config is present", () => {
  expect(isRoadTeacherAvatarUiEnabled()).toBe(true);
  delete process.env.NEXT_PUBLIC_RT_FIREBASE_API_KEY;
  expect(isRoadTeacherAvatarUiEnabled()).toBe(false);
});
it.each([
  "http://rt.example/replace",
  "javascript:bad",
  "https://user:pass@rt.example/replace",
  "invalid",
])("rejects unsafe RT endpoint %s", (endpoint) => {
  process.env.NEXT_PUBLIC_RT_SET_AVATAR_URL = endpoint;
  expect(getRoadTeacherConfig()).toBeNull();
});
it("never enables mock login in production even when its flag is set", () => {
  process.env.NEXT_PUBLIC_RT_MOCK = "true";
  vi.stubEnv("NODE_ENV", "production");
  expect(isRoadTeacherMockEnabled()).toBe(false);
});

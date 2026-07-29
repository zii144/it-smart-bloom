import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_CONSTRAINT_ATTEMPTS,
  describeCameraError,
  requestUserCamera,
} from "@/lib/camera-access";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("describeCameraError", () => {
  it("explains permission denial with site-settings guidance", () => {
    expect(
      describeCameraError(new DOMException("denied", "NotAllowedError")),
    ).toMatch(/鎖頭|網站設定/);
  });

  it("distinguishes missing cameras from permission blocks", () => {
    expect(
      describeCameraError(new DOMException("missing", "NotFoundError")),
    ).toMatch(/找不到可用的相機/);
  });
});

describe("requestUserCamera", () => {
  it("falls back when early constraints are overconstrained", async () => {
    const stream = { id: "ok" } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("too strict", "OverconstrainedError"),
      )
      .mockResolvedValueOnce(stream);

    await expect(requestUserCamera(getUserMedia)).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(
      1,
      CAMERA_CONSTRAINT_ATTEMPTS[0],
    );
    expect(getUserMedia).toHaveBeenNthCalledWith(
      2,
      CAMERA_CONSTRAINT_ATTEMPTS[1],
    );
  });

  it("does not retry after NotAllowedError", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    const getUserMedia = vi.fn().mockRejectedValue(denied);

    await expect(requestUserCamera(getUserMedia)).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

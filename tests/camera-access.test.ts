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
  it("warns about non-HTTPS phone LAN access", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    expect(
      describeCameraError(new DOMException("denied", "NotAllowedError")),
    ).toMatch(/HTTPS|localhost|192\.168/);
  });

  it("does not call permission-blocked copy for NotFoundError", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(
      describeCameraError(new DOMException("missing", "NotFoundError")),
    ).toMatch(/找不到相機/);
    expect(
      describeCameraError(new DOMException("missing", "NotFoundError")),
    ).not.toMatch(/權限遭到封鎖/);
  });

  it("explains permission denial with site-settings guidance", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(
      describeCameraError(new DOMException("denied", "NotAllowedError")),
    ).toMatch(/鎖頭|網站設定/);
  });
});

describe("requestUserCamera", () => {
  it("starts with soft facingMode and no hard resolution", () => {
    expect(CAMERA_CONSTRAINT_ATTEMPTS[0]).toEqual({
      video: { facingMode: { ideal: "user" } },
      audio: false,
    });
  });

  it("falls back when early constraints fail as NotFoundError", async () => {
    const stream = { id: "ok" } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("a", "NotFoundError"))
      .mockResolvedValueOnce(stream);

    await expect(
      requestUserCamera({ getUserMedia, isSecureContext: true }),
    ).resolves.toBe(stream);
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

  it("rejects insecure contexts before calling getUserMedia", async () => {
    const getUserMedia = vi.fn();
    await expect(
      requestUserCamera({ getUserMedia, isSecureContext: false }),
    ).rejects.toMatchObject({ name: "SecurityError" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("does not retry after NotAllowedError", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    const getUserMedia = vi.fn().mockRejectedValue(denied);

    await expect(
      requestUserCamera({ getUserMedia, isSecureContext: true }),
    ).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

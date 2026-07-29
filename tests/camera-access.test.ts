import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_CONSTRAINT_ATTEMPTS,
  describeCameraError,
  requestUserCamera,
} from "@/lib/camera-access";

/** Safari and Firefox expose OverconstrainedError outside the DOMException tree. */
function overconstrainedError(constraint = "") {
  return { name: "OverconstrainedError", message: "Invalid constraint", constraint };
}

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

  it("treats OverconstrainedError as an unavailable camera, not a block", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    const message = describeCameraError(overconstrainedError());
    expect(message).toMatch(/取不到相機/);
    expect(message).not.toMatch(/權限遭到封鎖/);
  });

  it("includes the failing constraint name when provided", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(describeCameraError(overconstrainedError("width"))).toMatch(
      /（width）/,
    );
  });

  it("still explains genuine permission denial", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(
      describeCameraError(new DOMException("denied", "NotAllowedError")),
    ).toMatch(/鎖頭|網站設定/);
  });

  it("names unexpected errors instead of guessing", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    expect(describeCameraError({ name: "AbortError" })).toMatch(/AbortError/);
  });
});

describe("requestUserCamera", () => {
  it("asks for a soft front camera with no size constraints first", () => {
    expect(CAMERA_CONSTRAINT_ATTEMPTS[0]).toEqual({
      video: { facingMode: { ideal: "user" } },
      audio: false,
    });
    expect(CAMERA_CONSTRAINT_ATTEMPTS.at(-1)).toEqual({
      video: true,
      audio: false,
    });
  });

  it("retries plain video after a non-DOMException OverconstrainedError", async () => {
    const stream = { id: "ok" } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(overconstrainedError("facingMode"))
      .mockResolvedValueOnce(stream);

    await expect(
      requestUserCamera({ getUserMedia, isSecureContext: true }),
    ).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { video: true, audio: false });
  });

  it("surfaces the last failure when every attempt fails", async () => {
    const failure = overconstrainedError();
    const getUserMedia = vi.fn().mockRejectedValue(failure);

    await expect(
      requestUserCamera({ getUserMedia, isSecureContext: true }),
    ).rejects.toBe(failure);
    expect(getUserMedia).toHaveBeenCalledTimes(
      CAMERA_CONSTRAINT_ATTEMPTS.length,
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

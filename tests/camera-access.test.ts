import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_CONSTRAINT_ATTEMPTS,
  describeCameraError,
  pickPreferredCamera,
  requestUserCamera,
} from "@/lib/camera-access";

function videoInput(deviceId: string, label: string) {
  return { kind: "videoinput", deviceId, label } as MediaDeviceInfo;
}

function streamOn(deviceId: string | null) {
  return {
    getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
    getTracks: () => [{ stop: () => {} }],
  } as unknown as MediaStream;
}

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

  it("asks for an explicitly chosen device before the generic attempts", async () => {
    const stream = streamOn("chosen");
    const getUserMedia = vi.fn().mockResolvedValue(stream);

    await requestUserCamera({
      getUserMedia,
      isSecureContext: true,
      deviceId: "chosen",
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { deviceId: { exact: "chosen" } },
      audio: false,
    });
  });
});

describe("pickPreferredCamera", () => {
  it("prefers the built-in camera over a Continuity camera", () => {
    expect(
      pickPreferredCamera([
        videoInput("phone", "ZII’S Camera"),
        videoInput("mac", "FaceTime HD Camera (3A71:F4B5)"),
      ]),
    ).toBe("mac");
  });

  it("prefers the front camera on phones", () => {
    expect(
      pickPreferredCamera([
        videoInput("b", "camera2 0, facing back"),
        videoInput("f", "camera2 1, facing front"),
      ]),
    ).toBe("f");
  });

  it("stays out of the way when labels are unavailable", () => {
    expect(
      pickPreferredCamera([videoInput("a", ""), videoInput("b", "")]),
    ).toBeNull();
  });

  it("stays out of the way when no camera looks built-in", () => {
    expect(
      pickPreferredCamera([
        videoInput("a", "ZII’S Camera"),
        videoInput("b", "Studio Cam"),
      ]),
    ).toBeNull();
  });
});

describe("requestUserCamera device refinement", () => {
  it("swaps a Continuity camera for the built-in one", async () => {
    const continuity = streamOn("phone");
    const builtIn = streamOn("mac");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(continuity)
      .mockResolvedValueOnce(builtIn);
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([
        videoInput("phone", "ZII’S Camera"),
        videoInput("mac", "FaceTime HD Camera"),
      ]);

    await expect(
      requestUserCamera({ getUserMedia, enumerateDevices, isSecureContext: true }),
    ).resolves.toBe(builtIn);
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      video: { deviceId: { exact: "mac" } },
      audio: false,
    });
  });

  it("keeps the original stream when it is already the built-in camera", async () => {
    const builtIn = streamOn("mac");
    const getUserMedia = vi.fn().mockResolvedValue(builtIn);
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([
        videoInput("phone", "ZII’S Camera"),
        videoInput("mac", "FaceTime HD Camera"),
      ]);

    await expect(
      requestUserCamera({ getUserMedia, enumerateDevices, isSecureContext: true }),
    ).resolves.toBe(builtIn);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("keeps the original stream when re-opening the preferred device fails", async () => {
    const continuity = streamOn("phone");
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(continuity)
      .mockRejectedValueOnce(new DOMException("gone", "NotReadableError"));
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([
        videoInput("phone", "ZII’S Camera"),
        videoInput("mac", "FaceTime HD Camera"),
      ]);

    await expect(
      requestUserCamera({ getUserMedia, enumerateDevices, isSecureContext: true }),
    ).resolves.toBe(continuity);
  });

  it("does not re-enumerate when the guest picked a device", async () => {
    const stream = streamOn("phone");
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const enumerateDevices = vi.fn();

    await requestUserCamera({
      getUserMedia,
      enumerateDevices,
      isSecureContext: true,
      deviceId: "phone",
    });

    expect(enumerateDevices).not.toHaveBeenCalled();
  });
});

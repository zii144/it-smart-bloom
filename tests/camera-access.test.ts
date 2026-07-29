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

  it("mentions system privacy settings when no camera is found", () => {
    expect(
      describeCameraError(new DOMException("missing", "NotFoundError")),
    ).toMatch(/隱私權與安全性/);
  });
});

describe("requestUserCamera", () => {
  it("tries the simplest constraints first", () => {
    expect(CAMERA_CONSTRAINT_ATTEMPTS[0]).toEqual({
      video: true,
      audio: false,
    });
  });

  it("falls back when early constraints are overconstrained", async () => {
    const stream = { id: "ok" } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException("too strict", "OverconstrainedError"),
      )
      .mockResolvedValueOnce(stream);
    const enumerateDevices = vi.fn().mockResolvedValue([]);

    await expect(
      requestUserCamera({ getUserMedia, enumerateDevices }),
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

  it("tries enumerated device ids after constraint failures", async () => {
    const stream = { id: "cam-2" } as unknown as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("a", "NotFoundError"))
      .mockRejectedValueOnce(new DOMException("b", "NotFoundError"))
      .mockRejectedValueOnce(new DOMException("c", "NotFoundError"))
      .mockResolvedValueOnce(stream);
    const enumerateDevices = vi.fn().mockResolvedValue([
      { kind: "audioinput", deviceId: "mic" },
      { kind: "videoinput", deviceId: "cam-2" },
    ]);

    await expect(
      requestUserCamera({ getUserMedia, enumerateDevices }),
    ).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      video: { deviceId: { exact: "cam-2" } },
      audio: false,
    });
  });

  it("does not retry after NotAllowedError", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    const getUserMedia = vi.fn().mockRejectedValue(denied);
    const enumerateDevices = vi.fn().mockResolvedValue([]);

    await expect(
      requestUserCamera({ getUserMedia, enumerateDevices }),
    ).rejects.toBe(denied);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

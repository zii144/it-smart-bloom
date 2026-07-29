// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraBooth } from "@/components/camera-booth";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const src = props.src as string | { src?: string } | undefined;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={typeof src === "string" ? src : src?.src}
        alt={String(props.alt ?? "")}
        className={props.className as string | undefined}
      />
    );
  },
}));

function fakeStream(deviceId = "built-in"): MediaStream {
  return {
    getTracks: () => [{ stop: () => {} }],
    getVideoTracks: () => [{ getSettings: () => ({ deviceId }) }],
  } as unknown as MediaStream;
}

function videoInput(deviceId: string, label: string) {
  return { kind: "videoinput", deviceId, label } as MediaDeviceInfo;
}

function stubCamera(
  streams: MediaStream | ((constraints: MediaStreamConstraints) => MediaStream),
  devices: MediaDeviceInfo[] = [videoInput("built-in", "FaceTime HD Camera")],
) {
  const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
    typeof streams === "function" ? streams(constraints) : streams,
  );
  const enumerateDevices = vi.fn(async () => devices);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia, enumerateDevices },
  });
  return { getUserMedia, enumerateDevices };
}

let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "isSecureContext", {
    configurable: true,
    value: true,
  });
  play = vi.fn(async () => undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    configurable: true,
    value: play,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CameraBooth stream attachment", () => {
  it("attaches the stream to the video element and starts playback", async () => {
    const stream = fakeStream();
    stubCamera(stream);

    const { container } = render(<CameraBooth />);
    fireEvent.click(container.querySelector("button.primary-button")!);

    const video = await waitFor(() => {
      const element = container.querySelector("video");
      if (!element) throw new Error("video not rendered");
      return element;
    });

    await waitFor(() => expect(video.srcObject).toBe(stream));
    expect(play).toHaveBeenCalled();
  });

  it("enables the shutter once metadata arrives, even without canplay", async () => {
    stubCamera(fakeStream());

    const { container } = render(<CameraBooth />);
    fireEvent.click(container.querySelector("button.primary-button")!);

    const video = await waitFor(() => {
      const element = container.querySelector("video");
      if (!element) throw new Error("video not rendered");
      return element;
    });

    const shutter = container.querySelector<HTMLButtonElement>("button.shutter");
    expect(shutter?.disabled).toBe(true);

    fireEvent.loadedMetadata(video);

    await waitFor(() =>
      expect(
        container.querySelector<HTMLButtonElement>("button.shutter")?.disabled,
      ).toBe(false),
    );
  });
});

describe("CameraBooth camera picker", () => {
  const twoCameras = [
    videoInput("phone", "ZII’S Camera"),
    videoInput("built-in", "FaceTime HD Camera"),
  ];

  it("stays hidden when the device has a single camera", async () => {
    stubCamera(fakeStream());

    const { container } = render(<CameraBooth />);
    fireEvent.click(container.querySelector("button.primary-button")!);

    await waitFor(() => expect(container.querySelector("video")).toBeTruthy());
    expect(container.querySelector(".camera-picker")).toBeNull();
  });

  it("lists both cameras and remembers the guest's choice", async () => {
    const { getUserMedia } = stubCamera(
      (constraints) =>
        fakeStream(
          typeof constraints.video === "object" &&
          "deviceId" in constraints.video
            ? "phone"
            : "built-in",
        ),
      twoCameras,
    );

    const { container } = render(<CameraBooth />);
    fireEvent.click(container.querySelector("button.primary-button")!);

    const select = await waitFor(() => {
      const element = container.querySelector<HTMLSelectElement>(
        ".camera-picker select",
      );
      if (!element) throw new Error("picker not rendered");
      return element;
    });

    expect([...select.options].map((option) => option.value)).toEqual([
      "phone",
      "built-in",
    ]);

    getUserMedia.mockClear();
    fireEvent.change(select, { target: { value: "phone" } });

    await waitFor(() =>
      expect(getUserMedia).toHaveBeenCalledWith({
        video: { deviceId: { exact: "phone" } },
        audio: false,
      }),
    );
    expect(window.localStorage.getItem("bloom.camera.deviceId")).toBe("phone");
  });
});

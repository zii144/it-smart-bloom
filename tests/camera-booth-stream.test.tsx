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

function enterBooth(container: HTMLElement) {
  const invitationButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("欣然赴約"),
  );
  if (!invitationButton) throw new Error("invitation button not rendered");
  fireEvent.click(invitationButton);
}

function enterCameraBooth(container: HTMLElement) {
  enterBooth(container);
  const lineId = container.querySelector<HTMLInputElement>("#guest-line-id");
  if (!lineId) throw new Error("LINE ID input not rendered");
  fireEvent.change(lineId, { target: { value: "112-張小明-南投縣" } });

  const cameraButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("改用現場相機"),
  );
  if (!cameraButton) throw new Error("camera option not rendered");
  fireEvent.click(cameraButton);
}

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
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:portrait-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CameraBooth stream attachment", () => {
  it("opens the LINE ID and image upload form from the invitation", () => {
    const { container } = render(<CameraBooth />);

    expect(container.textContent).toContain("一封綻放的邀請");
    expect(container.textContent).not.toContain("開啟相機");

    enterBooth(container);

    expect(container.textContent).toContain("路老師通用 LINE ID");
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(container.textContent).toContain("改用現場相機");
  });

  it("previews a valid uploaded image after collecting the LINE ID", () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);

    fireEvent.change(container.querySelector("#guest-line-id")!, {
      target: { value: "112-張小明-南投縣" },
    });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: {
        files: [
          new File([new Uint8Array([0xff, 0xd8, 0xff])], "portrait.jpg", {
            type: "image/jpeg",
          }),
        ],
      },
    });
    fireEvent.click(container.querySelector("button.guest-entry-submit")!);

    expect(container.textContent).toContain("就選這張嗎");
    expect(
      container.querySelector('img[alt="你剛拍下的人像照片"]'),
    ).toBeTruthy();
  });

  it("attaches the stream to the video element and starts playback", async () => {
    const stream = fakeStream();
    stubCamera(stream);

    const { container } = render(<CameraBooth />);
    enterCameraBooth(container);
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
    enterCameraBooth(container);
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
    enterCameraBooth(container);
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
    enterCameraBooth(container);
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

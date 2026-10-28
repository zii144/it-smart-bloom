// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraBooth } from "@/components/camera-booth";
import { INITIAL_CROP } from "@/lib/photo-crop";

const { renderCroppedMock } = vi.hoisted(() => ({ renderCroppedMock: vi.fn() }));

// jsdom cannot decode or draw images; the crop itself is tested on its own.
vi.mock("@/lib/photo-crop", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo-crop")>()),
  renderCroppedPhoto: renderCroppedMock,
}));

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

function fillGuestDetails(container: HTMLElement) {
  const name = container.querySelector<HTMLInputElement>("#guest-name");
  const phone = container.querySelector<HTMLInputElement>("#guest-phone");
  if (!name || !phone) throw new Error("guest detail inputs not rendered");
  fireEvent.change(name, { target: { value: "張小明" } });
  fireEvent.change(phone, { target: { value: "0912-345-678" } });
}

/** Leaves the guest form once the (stubbed) roster check has passed. */
async function enterCameraBooth(container: HTMLElement) {
  enterBooth(container);
  fillGuestDetails(container);

  const cameraButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("改用現場相機"),
  );
  if (!cameraButton) throw new Error("camera option not rendered");
  fireEvent.click(cameraButton);
  await waitFor(() => expect(container.textContent).not.toContain("改用現場相機"));
}

let verifyFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  renderCroppedMock.mockReset();
  renderCroppedMock.mockResolvedValue(new Blob(["cropped"], { type: "image/jpeg" }));
  verifyFetch = vi.fn(async () => Response.json({ matched: true }));
  vi.stubGlobal("fetch", verifyFetch);
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
  vi.unstubAllGlobals();
});

describe("CameraBooth stream attachment", () => {
  it("opens the name, phone and image upload form from the invitation", () => {
    const { container } = render(<CameraBooth />);

    // The invitation is shown first: its title is artwork, so assert the
    // accessible name rather than the visible text.
    expect(
      container.querySelector('#invitation-title img[alt="成果展"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("敬邀蒞臨");
    expect(container.textContent).not.toContain("開啟相機");
    // QA: check-in opens before the programme; no header badge.
    expect(container.textContent).toContain("14:00–15:3013:10開放入場");
    expect(container.textContent).not.toContain("私人創作空間");

    enterBooth(container);

    expect(container.textContent).not.toContain("LINE ID");
    expect(container.querySelector("#guest-name")).toBeTruthy();
    expect(container.querySelector("#guest-phone")).toBeTruthy();
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    // Guests are upload-only: no on-site camera option.
    expect(container.textContent).not.toContain("改用現場相機");
  });

  it("offers the on-site camera only when the booth turns it on", () => {
    const { container } = render(<CameraBooth cameraOption />);
    enterBooth(container);
    expect(container.textContent).toContain("改用現場相機");
  });

  it("asks for a valid phone number before previewing", () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);

    fireEvent.change(container.querySelector("#guest-name")!, {
      target: { value: "張小明" },
    });
    fireEvent.change(container.querySelector("#guest-phone")!, {
      target: { value: "12345" },
    });
    fireEvent.click(container.querySelector("button.guest-entry-submit")!);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "電話號碼",
    );
    expect(container.textContent).not.toContain("就選這張嗎");
  });

  it("lets the guest frame a valid uploaded image once they are on the roster", async () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);

    fillGuestDetails(container);
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

    await waitFor(() => expect(container.textContent).toContain("就選這張嗎"));
    // The upload opens in the framing tool: drag, zoom slider and reset.
    expect(
      container.querySelector('.photo-cropper-frame img[alt="你選擇的人像照片"]'),
    ).toBeTruthy();
    expect(container.querySelector('input[type="range"][aria-label="縮放照片"]')).toBeTruthy();
    expect(container.textContent).toContain("重新選擇照片");
    expect(verifyFetch).toHaveBeenCalledWith(
      "/api/roster/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "張小明", phone: "0912345678" }),
      }),
    );
  });

  it("goes to the success card once the portrait session exists", async () => {
    verifyFetch.mockImplementation(async (url: string) =>
      url === "/api/sessions"
        ? Response.json({ id: "sess-123" }, { status: 201 })
        : Response.json({ matched: true }),
    );
    const assign = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, assign },
    });

    try {
      const { container } = render(<CameraBooth />);
      enterBooth(container);
      fillGuestDetails(container);
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
      await waitFor(() => expect(container.textContent).toContain("就選這張嗎"));

      const usePhoto = [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("使用這張照片"),
      )!;
      fireEvent.click(usePhoto);

      await waitFor(() => expect(assign).toHaveBeenCalledWith("/success/sess-123"));
      const [, sessionCall] = verifyFetch.mock.calls.find(([url]) => url === "/api/sessions")!;
      const body = sessionCall.body as FormData;
      expect(body.get("name")).toBe("張小明");
      expect(body.get("phone")).toBe("0912345678");
      // What is sent is the square the guest framed, not the original file.
      expect(renderCroppedMock).toHaveBeenCalledWith("blob:portrait-preview", INITIAL_CROP);
      expect(await (body.get("image") as File).text()).toBe("cropped");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    }
  });

  it("still sends the whole photo if it cannot be cropped", async () => {
    renderCroppedMock.mockRejectedValue(new Error("photo could not be read"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    verifyFetch.mockImplementation(async (url: string) =>
      url === "/api/sessions"
        ? Response.json({ id: "sess-456" }, { status: 201 })
        : Response.json({ matched: true }),
    );
    const assign = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...realLocation, assign },
    });

    try {
      const { container } = render(<CameraBooth />);
      enterBooth(container);
      fillGuestDetails(container);
      fireEvent.change(container.querySelector('input[type="file"]')!, {
        target: {
          files: [new File(["original"], "portrait.jpg", { type: "image/jpeg" })],
        },
      });
      fireEvent.click(container.querySelector("button.guest-entry-submit")!);
      await waitFor(() => expect(container.textContent).toContain("就選這張嗎"));
      fireEvent.click(
        [...container.querySelectorAll("button")].find((button) =>
          button.textContent?.includes("使用這張照片"),
        )!,
      );

      await waitFor(() => expect(assign).toHaveBeenCalledWith("/success/sess-456"));
      const [, sessionCall] = verifyFetch.mock.calls.find(([url]) => url === "/api/sessions")!;
      expect(await ((sessionCall.body as FormData).get("image") as File).text()).toBe("original");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    }
  });

  it("keeps a guest who is not on the roster on the form", async () => {
    verifyFetch.mockResolvedValue(
      Response.json(
        { error: "找不到你的報名資料，請確認姓名與手機號碼，或洽現場工作人員。" },
        { status: 403 },
      ),
    );
    const { container } = render(<CameraBooth cameraOption />);
    enterBooth(container);
    fillGuestDetails(container);

    const cameraButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("改用現場相機"),
    )!;
    fireEvent.click(cameraButton);

    await waitFor(() =>
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "找不到你的報名資料",
      ),
    );
    expect(container.querySelector("#guest-name")).toBeTruthy();
    expect(container.textContent).toContain("改用現場相機");
  });

  it("attaches the stream to the video element and starts playback", async () => {
    const stream = fakeStream();
    stubCamera(stream);

    const { container } = render(<CameraBooth cameraOption />);
    await enterCameraBooth(container);
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

    const { container } = render(<CameraBooth cameraOption />);
    await enterCameraBooth(container);
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

    const { container } = render(<CameraBooth cameraOption />);
    await enterCameraBooth(container);
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

    const { container } = render(<CameraBooth cameraOption />);
    await enterCameraBooth(container);
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

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

const MOBILE = "0912345678";
const REAL_NAME = "王小明";
const OPTIONS = [REAL_NAME, "林大華", "陳怡君", "張家豪", "李淑芬"];

/** Stands in for /api/identity/challenge and /api/identity/verify. */
function stubIdentityApi({ correct = REAL_NAME } = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.endsWith("/api/identity/challenge")) {
      return new Response(
        JSON.stringify({
          challengeId: "sealed",
          options: OPTIONS,
          expiresAt: Date.now() + 300_000,
          attemptsRemaining: 5,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (url.endsWith("/api/identity/verify")) {
      return body.answer === correct
        ? new Response(
            JSON.stringify({
              identityToken: "v1.token.signature",
              expiresAt: Date.now() + 900_000,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          )
        : new Response(
            JSON.stringify({
              error: "名字不正確，還可以再試 4 次。",
              code: "IDENTITY_ANSWER_WRONG",
              attemptsRemaining: 4,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
    }

    throw new Error(`unexpected fetch: ${url}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Types the number and answers the name challenge, the way a guest does. */
async function verifyMobile(container: HTMLElement, answer = REAL_NAME) {
  const mobile = container.querySelector<HTMLInputElement>("#guest-mobile");
  if (!mobile) throw new Error("mobile input not rendered");
  fireEvent.change(mobile, { target: { value: MOBILE } });

  const startButton = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("驗證手機號碼"),
  );
  if (!startButton) throw new Error("verify button not rendered");
  fireEvent.click(startButton);

  await waitFor(() => {
    if (!container.textContent?.includes("請選出這支號碼登記的姓名")) {
      throw new Error("challenge not shown");
    }
  });

  const option = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === answer,
  );
  if (!option) throw new Error(`option ${answer} not rendered`);
  fireEvent.click(option);
}

function enterBooth(container: HTMLElement) {
  const invitationButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("欣然赴約"),
  );
  if (!invitationButton) throw new Error("invitation button not rendered");
  fireEvent.click(invitationButton);
}

async function enterCameraBooth(container: HTMLElement) {
  enterBooth(container);
  await verifyMobile(container);
  await waitFor(() => {
    if (!container.textContent?.includes("已完成驗證")) {
      throw new Error("verification not completed");
    }
  });

  const cameraButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("改用現場相機"),
  );
  if (!cameraButton) throw new Error("camera option not rendered");
  fireEvent.click(cameraButton);
}

beforeEach(() => {
  window.localStorage.clear();
  stubIdentityApi();
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
  it("opens the mobile and image upload form from the invitation", () => {
    const { container } = render(<CameraBooth />);

    // The invitation is shown first: its title is artwork, so assert the
    // accessible name rather than the visible text.
    expect(
      container.querySelector('#invitation-title img[alt="成果展"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("敬邀蒞臨");
    expect(container.textContent).not.toContain("開啟相機");

    enterBooth(container);

    expect(container.textContent).toContain("手機號碼");
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(container.textContent).toContain("改用現場相機");
  });

  it("previews a valid uploaded image after verifying the mobile", async () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);
    await verifyMobile(container);
    await waitFor(() => {
      if (!container.textContent?.includes("已完成驗證")) {
        throw new Error("verification not completed");
      }
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

    const { container } = render(<CameraBooth />);
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

    const { container } = render(<CameraBooth />);
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

    const { container } = render(<CameraBooth />);
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

describe("CameraBooth identity challenge", () => {
  function verified(container: HTMLElement) {
    return waitFor(() => {
      if (!container.textContent?.includes("已完成驗證")) {
        throw new Error("verification not completed");
      }
    });
  }

  // A photo must never be taken against a number nobody has proven.
  it("keeps the photo picker and both submits locked until verified", async () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);

    const file = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const submit = container.querySelector<HTMLButtonElement>(
      "button.guest-entry-submit",
    )!;
    const camera = container.querySelector<HTMLButtonElement>(
      "button.guest-camera-option",
    )!;

    expect(file.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(camera.disabled).toBe(true);

    await verifyMobile(container);
    await verified(container);

    expect(file.disabled).toBe(false);
    expect(submit.disabled).toBe(false);
    expect(camera.disabled).toBe(false);
  });

  it("shows the remaining attempts and a fresh line-up after a wrong name", async () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);

    await verifyMobile(container, "林大華");

    await waitFor(() => {
      if (!container.textContent?.includes("還可以再試 4 次")) {
        throw new Error("attempt count not shown");
      }
    });
    expect(container.textContent).not.toContain("已完成驗證");
    // Still on the challenge, with a newly issued option set.
    expect(container.textContent).toContain("請選出這支號碼登記的姓名");
  });

  it("re-verifies the same number from storage without another challenge", async () => {
    const first = render(<CameraBooth />);
    enterBooth(first.container);
    await verifyMobile(first.container);
    await verified(first.container);

    cleanup();
    const fetchMock = stubIdentityApi();
    const second = render(<CameraBooth />);
    enterBooth(second.container);

    fireEvent.change(
      second.container.querySelector<HTMLInputElement>("#guest-mobile")!,
      { target: { value: MOBILE } },
    );
    fireEvent.click(
      [...second.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("驗證手機號碼"),
      )!,
    );

    await verified(second.container);
    // Restored from the signed token, so road-teacher was never asked again.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The booth is shared: the next guest's number must not match the last one.
  it("challenges a different number even with a stored verification", async () => {
    const first = render(<CameraBooth />);
    enterBooth(first.container);
    await verifyMobile(first.container);
    await verified(first.container);

    cleanup();
    const fetchMock = stubIdentityApi();
    const second = render(<CameraBooth />);
    enterBooth(second.container);

    fireEvent.change(
      second.container.querySelector<HTMLInputElement>("#guest-mobile")!,
      { target: { value: "0987654321" } },
    );
    fireEvent.click(
      [...second.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("驗證手機號碼"),
      )!,
    );

    await waitFor(() => {
      if (!second.container.textContent?.includes("請選出這支號碼登記的姓名")) {
        throw new Error("challenge not shown for the new number");
      }
    });
    expect(fetchMock).toHaveBeenCalled();
    expect(second.container.textContent).not.toContain("已完成驗證");
  });

  it("drops the verification when the guest changes the number", async () => {
    const { container } = render(<CameraBooth />);
    enterBooth(container);
    await verifyMobile(container);
    await verified(container);

    fireEvent.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("換一支號碼"),
      )!,
    );

    expect(container.textContent).not.toContain("已完成驗證");
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled,
    ).toBe(true);
    expect(window.localStorage.getItem("bloom.identity.v1")).toBeNull();
  });
});

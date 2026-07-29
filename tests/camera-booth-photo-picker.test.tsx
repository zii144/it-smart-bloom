// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraBooth } from "@/components/camera-booth";

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
  }: {
    src: string | { src: string };
    alt: string;
  }) => (
    // Test stub: image optimization behavior is outside this component test.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={typeof src === "string" ? src : src.src} alt={alt} />
  ),
}));

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }),
  );
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:portrait-preview"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CameraBooth photo picker fallback", () => {
  it("offers a native photo picker alongside the camera button", () => {
    const { container } = render(<CameraBooth />);

    expect(
      screen.getByRole("button", { name: /開啟相機/ }),
    ).toBeTruthy();
    expect(screen.getByText("拍照或選擇照片")).toBeTruthy();

    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(input?.accept).toBe("image/jpeg,image/png,image/webp");
    expect(input?.getAttribute("capture")).toBe("user");
  });

  it("previews a selected photo without getUserMedia", async () => {
    const user = userEvent.setup();
    const { container } = render(<CameraBooth />);
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    expect(input).toBeTruthy();

    await user.upload(
      input!,
      new File(["portrait"], "portrait.jpg", { type: "image/jpeg" }),
    );

    expect(
      screen.getByRole("heading", { name: "就選這張嗎？" }),
    ).toBeTruthy();
    expect(screen.getByAltText("你剛拍下的人像照片")).toBeTruthy();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
  });

  it("rejects unsupported image formats", async () => {
    const user = userEvent.setup({
      applyAccept: false,
    });
    const { container } = render(<CameraBooth />);
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );

    await user.upload(
      input!,
      new File(["portrait"], "portrait.gif", { type: "image/gif" }),
    );

    expect(screen.getByText("請選擇 JPG、PNG 或 WebP 圖片。")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "就選這張嗎？" }),
    ).toBeNull();
  });
});

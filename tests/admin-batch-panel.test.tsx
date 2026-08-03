// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminBatchPanel } from "@/components/admin-batch-panel";
import type { ImageGenerationOptions } from "@/lib/image-options";

const defaults: ImageGenerationOptions = {
  model: "gpt-image-2",
  quality: "medium",
  size: "1024x1024",
  outputFormat: "jpeg",
  outputCompression: 90,
  fakeGenerate: false,
};

type BatchCall = { imageName: string; imageOptions: string | null };

/** Fetch double for POST /api/admin30910/batch. */
function mockBatchApi(
  respond: (call: BatchCall, index: number) => Response = () =>
    new Response(
      JSON.stringify({
        id: "session-id",
        status: "complete",
        resultUrl: "/api/admin30910/sessions/session-id/image?kind=result",
        resultMime: "image/jpeg",
      }),
      { status: 200 },
    ),
) {
  const calls: BatchCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toContain("/api/admin30910/batch");
    const body = init?.body as FormData;
    const image = body.get("image") as File;
    const options = body.get("imageOptions");
    const call: BatchCall = {
      imageName: image.name,
      imageOptions: typeof options === "string" ? options : null,
    };
    calls.push(call);
    return respond(call, calls.length - 1);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function photo(name: string, type = "image/jpeg") {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type });
}

function renderPanel(overrides: Partial<Parameters<typeof AdminBatchPanel>[0]> = {}) {
  return render(
    <AdminBatchPanel
      defaults={defaults}
      hasOpenAiKey
      hasOpenAiPrompt
      imageTuning={false}
      {...overrides}
    />,
  );
}

function fileInput() {
  return screen.getByLabelText(/選擇照片或拖曳到這裡/);
}

function dropZone() {
  return screen.getByText(/選擇照片或拖曳到這裡/).closest("label") as HTMLElement;
}

function startButton() {
  return screen.getByRole("button", { name: /開始生成/ });
}

beforeEach(() => {
  mockBatchApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AdminBatchPanel — queue", () => {
  it("starts empty and cannot generate", () => {
    renderPanel();

    expect(screen.getByText("尚未選擇照片。")).toBeTruthy();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("queues picked photos and counts them on the start button", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.upload(fileInput(), [photo("a.jpg"), photo("b.jpg")]);

    expect(screen.getByText("a.jpg")).toBeTruthy();
    expect(screen.getByText("b.jpg")).toBeTruthy();
    expect(screen.getAllByText("等待中")).toHaveLength(2);
    expect(startButton().textContent).toContain("2 張");
  });

  // The file picker filters by `accept`, so an unsupported type only ever
  // arrives by drag-and-drop.
  it("rejects dropped files the API would refuse anyway", () => {
    renderPanel();

    fireEvent.drop(dropZone(), {
      dataTransfer: { files: [photo("ok.jpg"), photo("notes.txt", "text/plain")] },
    });

    expect(screen.getByText("只支援 JPEG、PNG 或 WebP。")).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(startButton().textContent).toContain("1 張");
  });

  it("rejects photos larger than the 12 MB upload limit", () => {
    renderPanel();
    const oversized = new File(
      [new Uint8Array(12 * 1024 * 1024 + 1)],
      "huge.jpg",
      { type: "image/jpeg" },
    );

    fireEvent.drop(dropZone(), { dataTransfer: { files: [oversized] } });

    expect(screen.getByText("照片大小必須小於 12 MB。")).toBeTruthy();
    expect((startButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not call the API until the admin presses start", async () => {
    const user = userEvent.setup();
    const { fetchMock } = mockBatchApi();
    renderPanel();

    await user.upload(fileInput(), [photo("a.jpg")]);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AdminBatchPanel — generation", () => {
  it("posts every photo and links the finished portraits", async () => {
    const user = userEvent.setup();
    const { calls } = mockBatchApi((call) => {
      const id = call.imageName.replace(".jpg", "");
      return new Response(
        JSON.stringify({
          id,
          status: "complete",
          resultUrl: `/api/admin30910/sessions/${id}/image?kind=result`,
          resultMime: "image/jpeg",
        }),
        { status: 200 },
      );
    });
    renderPanel();

    await user.upload(fileInput(), [
      photo("a.jpg"),
      photo("b.jpg"),
      photo("c.jpg"),
    ]);
    await user.click(startButton());

    await waitFor(() => expect(screen.getAllByText("已完成")).toHaveLength(3));
    expect(calls.map((call) => call.imageName)).toEqual([
      "a.jpg",
      "b.jpg",
      "c.jpg",
    ]);

    const download = screen.getAllByRole("link", { name: "下載" })[0];
    expect(download.getAttribute("href")).toBe(
      "/api/admin30910/sessions/a/image?kind=result",
    );
    expect(download.getAttribute("download")).toBe("bloom-a.jpg");
  });

  it("leaves image options to the server so the .env prompt and defaults win", async () => {
    const user = userEvent.setup();
    const { calls } = mockBatchApi();
    renderPanel();

    await user.upload(fileInput(), [photo("a.jpg")]);
    await user.click(startButton());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].imageOptions).toBeNull();
  });

  it("sends explicit options once the admin overrides the .env defaults", async () => {
    const user = userEvent.setup();
    const { calls } = mockBatchApi();
    renderPanel();

    await user.click(screen.getByRole("checkbox", { name: /使用 .env 參數/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /品質/ }),
      "low",
    );
    await user.upload(fileInput(), [photo("a.jpg")]);
    await user.click(startButton());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0].imageOptions as string)).toMatchObject({
      model: "gpt-image-2",
      quality: "low",
      fakeGenerate: false,
    });
  });

  it("shows the server error and offers a retry", async () => {
    const user = userEvent.setup();
    let attempt = 0;
    mockBatchApi(() => {
      attempt += 1;
      return attempt === 1
        ? new Response(JSON.stringify({ error: "OpenAI rate limit reached" }), {
            status: 500,
          })
        : new Response(
            JSON.stringify({
              id: "recovered",
              status: "complete",
              resultUrl:
                "/api/admin30910/sessions/recovered/image?kind=result",
              resultMime: "image/jpeg",
            }),
            { status: 200 },
          );
    });
    renderPanel();

    await user.upload(fileInput(), [photo("a.jpg")]);
    await user.click(startButton());

    expect(await screen.findByText("OpenAI rate limit reached")).toBeTruthy();
    expect(screen.getByText("失敗")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /重試失敗/ }));

    await waitFor(() => expect(screen.getByText("已完成")).toBeTruthy());
    expect(attempt).toBe(2);
  });

  it("clears finished rows so the next batch starts clean", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.upload(fileInput(), [photo("a.jpg")]);
    await user.click(startButton());
    await waitFor(() => expect(screen.getByText("已完成")).toBeTruthy());

    await user.click(screen.getByRole("button", { name: /清除已完成/ }));

    expect(screen.getByText("尚未選擇照片。")).toBeTruthy();
  });
});

describe("AdminBatchPanel — configuration warnings", () => {
  it("warns when the env system prompt is missing", () => {
    renderPanel({ hasOpenAiPrompt: false });

    expect(
      screen.getByText(/尚未設定 OPENAI_IMAGE_SYSTEM_PROMPT/),
    ).toBeTruthy();
  });

  it("warns when the API key is missing", () => {
    renderPanel({ hasOpenAiKey: false });

    expect(screen.getByText(/尚未設定 OPENAI_API_KEY/)).toBeTruthy();
  });

  it("offers fake generate only where image tuning is enabled", async () => {
    const user = userEvent.setup();
    const { calls } = mockBatchApi();
    const { rerender } = renderPanel();

    expect(screen.queryByRole("checkbox", { name: /假生成/ })).toBeNull();

    rerender(
      <AdminBatchPanel
        defaults={defaults}
        hasOpenAiKey
        hasOpenAiPrompt
        imageTuning
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /假生成/ }));
    await user.upload(fileInput(), [photo("a.jpg")]);
    await user.click(startButton());

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(calls[0].imageOptions as string)).toMatchObject({
      fakeGenerate: true,
    });
  });
});

describe("AdminBatchPanel — rows", () => {
  it("removes a single queued photo", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.upload(fileInput(), [photo("a.jpg"), photo("b.jpg")]);
    const row = screen.getByText("a.jpg").closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "移除 a.jpg" }));

    expect(screen.queryByText("a.jpg")).toBeNull();
    expect(screen.getByText("b.jpg")).toBeTruthy();
  });
});

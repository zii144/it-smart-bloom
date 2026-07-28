// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionExperience } from "@/components/session-experience";

// Static image imports carry no width/height outside a Next build, and props
// like `fill` / `unoptimized` are not valid DOM attributes.
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

type SessionPayload = {
  id: string;
  status: "ready" | "generating" | "complete" | "failed";
  createdAt: string;
  startedAt: string | null;
  expiresAt: string;
  inputUrl: string;
  resultUrl: string | null;
  error: string | null;
  generationOptions?: Record<string, unknown> | null;
};

const SESSION_ID = "a".repeat(32);

const DEV_DEFAULTS = {
  model: "gpt-image-2",
  quality: "medium",
  size: "1024x1024",
  outputFormat: "jpeg",
  outputCompression: 90,
  fakeGenerate: false,
};

function sessionPayload(
  overrides: Partial<SessionPayload> = {},
): SessionPayload {
  const createdAt = new Date().toISOString();
  return {
    id: SESSION_ID,
    status: "generating",
    createdAt,
    startedAt: createdAt,
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    inputUrl: `/api/sessions/${SESSION_ID}/image?kind=input`,
    resultUrl: null,
    error: null,
    generationOptions: null,
    ...overrides,
  };
}

/** Minimal fetch double for the two endpoints the phone talks to. */
function mockFetch(options: {
  status: () => SessionPayload;
  generate?: () => SessionPayload;
  statusError?: { status: number; error: string };
}) {
  const generateCalls: unknown[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes("/api/dev/image-options")) {
      return new Response(
        JSON.stringify({ defaults: DEV_DEFAULTS, hasApiKey: true }),
        { status: 200 },
      );
    }

    if (url.endsWith("/generate")) {
      generateCalls.push(init?.body ? JSON.parse(String(init.body)) : null);
      const payload = options.generate?.() ?? options.status();
      return new Response(JSON.stringify(payload), { status: 200 });
    }

    if (options.statusError) {
      return new Response(JSON.stringify({ error: options.statusError.error }), {
        status: options.statusError.status,
      });
    }

    return new Response(JSON.stringify(options.status()), { status: 200 });
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, generateCalls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("SessionExperience — guest journey", () => {
  it("shows the waiting screen with elapsed time while rendering", async () => {
    mockFetch({ status: () => sessionPayload({ status: "generating" }) });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    expect(
      await screen.findByRole("heading", { name: "你的似顏繪，正在悄悄綻放。" }),
    ).toBeDefined();
    expect(screen.getByRole("progressbar")).toBeDefined();
    expect(screen.getByText(/0:0\d/)).toBeDefined();
  });

  it("keeps the guest informed that the page must stay open", async () => {
    mockFetch({ status: () => sessionPayload({ status: "generating" }) });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    expect(
      await screen.findByText(/請保持此頁面開啟。.*一至三分鐘內完成。/),
    ).toBeDefined();
  });

  it("shows the finished portrait with a download link", async () => {
    mockFetch({
      status: () =>
        sessionPayload({
          status: "complete",
          resultUrl: `/api/sessions/${SESSION_ID}/image?kind=result`,
        }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    const download = await screen.findByRole("link", {
      name: "下載我的專屬人像",
    });
    expect(download.getAttribute("href")).toBe(
      `/api/sessions/${SESSION_ID}/image?kind=result&download=1`,
    );
    expect(screen.getByText("此連結將於 15 分鐘後失效")).toBeDefined();
  });

  it("offers a retry when the render failed", async () => {
    mockFetch({
      status: () =>
        sessionPayload({
          status: "failed",
          error: "無法完成這次創作，請回到拍照裝置後再試一次。",
        }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    expect(
      await screen.findByRole("heading", { name: "讓我們再試一次。" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "重新生成我的人像" }),
    ).toBeDefined();
  });

  it("explains an expired link instead of spinning forever", async () => {
    mockFetch({
      status: () => sessionPayload(),
      statusError: { status: 410, error: "這個人像創作連結已經失效。" },
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    expect(await screen.findByText("這個人像創作連結已經失效。")).toBeDefined();
  });

  it("hides the dev tuning affordances from guests", async () => {
    mockFetch({
      status: () =>
        sessionPayload({
          status: "complete",
          resultUrl: `/api/sessions/${SESSION_ID}/image?kind=result`,
        }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    await screen.findByRole("link", { name: "下載我的專屬人像" });
    expect(screen.queryByText(/^Dev：/)).toBeNull();
  });
});

describe("SessionExperience — generation kickoff", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("does not start a render that the server already began", async () => {
    const { generateCalls } = mockFetch({
      status: () => sessionPayload({ status: "generating" }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(generateCalls).toHaveLength(0);
  });

  it("starts the render itself when the session is still ready after the grace period", async () => {
    const stale = new Date(Date.now() - 30_000).toISOString();
    const { generateCalls } = mockFetch({
      status: () =>
        sessionPayload({
          status: "ready",
          createdAt: stale,
          startedAt: null,
        }),
      generate: () =>
        sessionPayload({
          status: "complete",
          resultUrl: `/api/sessions/${SESSION_ID}/image?kind=result`,
        }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0]).toMatchObject({ force: false });
  });

  it("only fires one generate request even across repeated polls", async () => {
    const stale = new Date(Date.now() - 30_000).toISOString();
    const { generateCalls } = mockFetch({
      status: () =>
        sessionPayload({ status: "ready", createdAt: stale, startedAt: null }),
      generate: () => sessionPayload({ status: "generating" }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(generateCalls).toHaveLength(1);
  });

  it("waits for the dev modal when tuning is on and nothing was chosen", async () => {
    const stale = new Date(Date.now() - 30_000).toISOString();
    const { generateCalls } = mockFetch({
      status: () =>
        sessionPayload({ status: "ready", createdAt: stale, startedAt: null }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled />);
    await vi.advanceTimersByTimeAsync(5_000);

    await waitFor(() =>
      expect(screen.getByText("先選好開發參數。")).toBeDefined(),
    );
    expect(generateCalls).toHaveLength(0);
  });
});

describe("SessionExperience — connectivity", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("says it is connecting rather than faking render progress", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);

    expect(screen.getByRole("heading", { name: "正在連線…" })).toBeDefined();
  });

  it("keeps the clock moving while it cannot reach the server", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    expect(screen.getByText(/0:00/)).toBeDefined();

    await vi.advanceTimersByTimeAsync(4_000);
    await waitFor(() => expect(screen.getByText(/0:0[34]/)).toBeDefined());
  });

  it("offers a reload once connecting has clearly failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(13_000);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "連不上創作空間。" })).toBeDefined(),
    );
    expect(screen.getByRole("button", { name: "重新整理" })).toBeDefined();
  });

  it("recovers from a dropped request instead of dying permanently", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts <= 2) throw new TypeError("Load failed");
        return new Response(
          JSON.stringify(
            sessionPayload({
              status: "complete",
              resultUrl: `/api/sessions/${SESSION_ID}/image?kind=result`,
            }),
          ),
          { status: 200 },
        );
      }),
    );

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(8_000);

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "下載我的專屬人像" }),
      ).toBeDefined(),
    );
    expect(attempts).toBeGreaterThan(2);
  });

  it("catches up as soon as the phone wakes, without waiting for a tick", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return new Response(
          JSON.stringify(
            calls === 1
              ? sessionPayload({ status: "generating" })
              : sessionPayload({
                  status: "complete",
                  resultUrl: `/api/sessions/${SESSION_ID}/image?kind=result`,
                }),
          ),
          { status: 200 },
        );
      }),
    );

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await waitFor(() => expect(calls).toBe(1));

    // Well short of POLL_INTERVAL_MS, so only the wake handler can explain it.
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(50);

    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "下載我的專屬人像" }),
      ).toBeDefined(),
    );
  });

  it("still treats an expired link as final", async () => {
    mockFetch({
      status: () => sessionPayload(),
      statusError: { status: 410, error: "這個人像創作連結已經失效。" },
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(6_000);

    await waitFor(() =>
      expect(screen.getByText("這個人像創作連結已經失效。")).toBeDefined(),
    );
  });
});

describe("SessionExperience — stalled render", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("keeps a failed retry visible instead of reverting to fake progress", async () => {
    const longAgo = new Date(Date.now() - 300_000).toISOString();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/generate")) {
          return new Response(JSON.stringify({ error: "尚未設定 OPENAI_API_KEY。" }), {
            status: 500,
          });
        }
        // The server never actually started, so polling keeps saying "ready".
        return new Response(
          JSON.stringify(
            sessionPayload({
              status: "ready",
              createdAt: longAgo,
              startedAt: null,
            }),
          ),
          { status: 200 },
        );
      }),
    );

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "重新生成我的人像" }),
      ).toBeDefined(),
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成我的人像" }));
    await waitFor(() =>
      expect(screen.getByText("尚未設定 OPENAI_API_KEY。")).toBeDefined(),
    );

    // Several polls later the guest must still be able to see what went wrong.
    await vi.advanceTimersByTimeAsync(6_000);
    expect(screen.getByText("尚未設定 OPENAI_API_KEY。")).toBeDefined();
  });

  it("admits the render is stuck and offers a retry", async () => {
    const longAgo = new Date(Date.now() - 300_000).toISOString();
    mockFetch({
      status: () =>
        sessionPayload({
          status: "generating",
          createdAt: longAgo,
          startedAt: longAgo,
        }),
    });

    render(<SessionExperience id={SESSION_ID} tuningEnabled={false} />);
    await vi.advanceTimersByTimeAsync(2_000);

    await waitFor(() =>
      expect(screen.getByText("比預期久了一些。")).toBeDefined(),
    );
    expect(
      screen.getByRole("button", { name: "重新生成我的人像" }),
    ).toBeDefined();
  });
});

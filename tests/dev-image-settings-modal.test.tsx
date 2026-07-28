// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DevImageSettingsModal,
  FAKE_GENERATE_PREF_KEY,
} from "@/components/dev-image-settings-modal";
import type { ImageGenerationOptions } from "@/lib/image-options";

const defaults: ImageGenerationOptions = {
  model: "gpt-image-2",
  quality: "medium",
  size: "1024x1024",
  outputFormat: "jpeg",
  outputCompression: 90,
  fakeGenerate: false,
};

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ defaults, hasApiKey: false }),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DevImageSettingsModal — fake generate", () => {
  it("hides the API key warning while fake generate is on", async () => {
    const user = userEvent.setup();
    render(
      <DevImageSettingsModal open onConfirm={() => undefined} />,
    );

    expect(
      await screen.findByText(/尚未設定 OPENAI_API_KEY/),
    ).toBeTruthy();

    await user.click(screen.getByRole("checkbox"));
    expect(screen.queryByText(/尚未設定 OPENAI_API_KEY/)).toBeNull();
    expect(screen.getByText(/流程測試模式/)).toBeTruthy();
  });

  it("remembers the fake-generate preference in localStorage", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DevImageSettingsModal open onConfirm={onConfirm} />);

    await screen.findByText(/假生成 Fake generate/);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "假生成並繼續" }));

    expect(window.localStorage.getItem(FAKE_GENERATE_PREF_KEY)).toBe("1");
    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ fakeGenerate: true }),
    );
  });

  it("restores the sticky preference on open", async () => {
    window.localStorage.setItem(FAKE_GENERATE_PREF_KEY, "1");
    render(<DevImageSettingsModal open onConfirm={() => undefined} />);

    const checkbox = await screen.findByRole("checkbox");
    expect((checkbox as HTMLInputElement).checked).toBe(true);
  });
});

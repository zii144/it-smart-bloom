import { describe, expect, it } from "vitest";
import { buildLineShareUrl } from "@/lib/line-share";

describe("buildLineShareUrl", () => {
  const sessionUrl = "https://it-smart-bloom.vercel.app/s/abc123";

  it("shares a bare url", () => {
    const shared = buildLineShareUrl(sessionUrl);
    expect(shared.startsWith("https://line.me/R/share?text=")).toBe(true);
    expect(decodeURIComponent(shared.split("text=")[1])).toBe(sessionUrl);
  });

  it("puts the message on its own line above the url", () => {
    const shared = buildLineShareUrl(sessionUrl, "開啟你的路老師似顏繪");
    expect(decodeURIComponent(shared.split("text=")[1])).toBe(
      `開啟你的路老師似顏繪\n${sessionUrl}`,
    );
  });

  it("percent-encodes characters that would break the query string", () => {
    const shared = buildLineShareUrl("https://example.com/s/a b&c=d");
    expect(shared).not.toContain(" ");
    expect(shared).not.toContain("&c=");
    expect(shared).toContain("%20");
  });
});

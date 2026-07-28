import { describe, expect, it } from "vitest";
import {
  FACEBOOK_SHARE_QUOTE,
  buildFacebookShareUrl,
} from "@/lib/facebook-share";

describe("buildFacebookShareUrl", () => {
  const siteUrl = "https://it-smart-bloom.vercel.app/";

  it("shares a bare url", () => {
    const shared = buildFacebookShareUrl(siteUrl);
    expect(shared.startsWith("https://www.facebook.com/sharer/sharer.php?")).toBe(
      true,
    );
    expect(new URL(shared).searchParams.get("u")).toBe(siteUrl);
    expect(new URL(shared).searchParams.has("quote")).toBe(false);
  });

  it("includes the quote when provided", () => {
    const shared = buildFacebookShareUrl(siteUrl, FACEBOOK_SHARE_QUOTE);
    const params = new URL(shared).searchParams;
    expect(params.get("u")).toBe(siteUrl);
    expect(params.get("quote")).toBe(FACEBOOK_SHARE_QUOTE);
  });

  it("percent-encodes characters that would break the query string", () => {
    const shared = buildFacebookShareUrl(
      "https://example.com/s/a b&c=d",
      "光 & 綻放",
    );
    expect(shared).not.toContain(" ");
    expect(shared).toContain("u=");
    expect(shared).toContain("quote=");
    expect(decodeURIComponent(new URL(shared).searchParams.get("u")!)).toBe(
      "https://example.com/s/a b&c=d",
    );
    expect(new URL(shared).searchParams.get("quote")).toBe("光 & 綻放");
  });
});

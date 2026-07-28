/** Default quote for the Facebook share dialog — warm, on-brand, and invitation-forward. */
export const FACEBOOK_SHARE_QUOTE =
  "一路走來的光，已然綻放！我剛在「智晟｜綻放」畫成了專屬的路老師似顏繪，你也來試試？";

/** Open Facebook share dialog for a URL (and optional quote). */
export function buildFacebookShareUrl(url: string, quote?: string) {
  const params = new URLSearchParams({ u: url });
  if (quote) params.set("quote", quote);
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

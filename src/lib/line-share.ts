/** Open LINE share sheet with a URL (and optional message). */
export function buildLineShareUrl(url: string, message?: string) {
  const text = message ? `${message}\n${url}` : url;
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}

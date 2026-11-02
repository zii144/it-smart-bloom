/** Hands a blob to the browser as a download named `filename`. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking at once can cancel a large download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Today in Taipei as `YYYY-MM-DD`, for file names. */
export function taipeiDateStamp() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

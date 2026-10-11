/**
 * Hands a blob to the browser as a file download. The anchor joins the
 * document so Firefox honours the click, and the object URL is revoked later:
 * revoking synchronously races the navigation the click started and lands as
 * a silently cancelled download in Chromium.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

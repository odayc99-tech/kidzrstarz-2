/** Download an authorized attachment; callers obtain its URL from the order API. */
export async function downloadFile(url: string, filename: string, proxyUrl?: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(proxyUrl || url);
  } catch (error) {
    // Cross-origin S3 downloads can be blocked from fetch while a navigation is allowed.
    // Do not use this fallback for an HTTP error or a known empty/invalid body.
    if (!(error instanceof TypeError)) throw error;
    startLinkDownload(url, filename, true);
    return;
  }

  if (!response.ok) {
    throw new Error(`Download unavailable (${response.status}). Please refresh and try again.`);
  }
  const blob = await response.blob();
  if (blob.size === 0) {
    throw new Error("The download is empty or not ready. Please refresh and try again.");
  }
  const contentType = (response.headers?.get("content-type") || blob.type).toLowerCase();
  if (/^(text\/(html|xml)|application\/(json|xml))/.test(contentType)) {
    throw new Error("The server returned an error document instead of your file. Please refresh and try again.");
  }
  if (/\.mp4$/i.test(filename)) {
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const boxType = header.length >= 8
      ? String.fromCharCode(header[4], header[5], header[6], header[7])
      : "";
    if (boxType !== "ftyp") {
      throw new Error("The video download is not a valid MP4. Please refresh and try again.");
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  try {
    startLinkDownload(blobUrl, filename);
  } finally {
    // Revoking immediately after click can race the browser's download startup.
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }
}

function startLinkDownload(url: string, filename: string, newTab = false): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  if (newTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    document.body.removeChild(link);
  }
}

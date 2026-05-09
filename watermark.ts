import sharp from "sharp";
import { storagePut, storageGetSignedUrl } from "../storage";

/**
 * Resolve a possibly-relative /manus-storage/... URL to an absolute URL.
 * Relative paths are converted via a presigned GET URL so they can be
 * fetched from any context (server-side or external).
 */
async function resolveUrl(url: string): Promise<string> {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  const key = url.replace(/^\/manus-storage\//, "");
  return storageGetSignedUrl(key);
}

const LOGO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/kidzrstarz-logo_5f53c312.png";

export async function applyWatermark(params: {
  imageUrl: string;
  orderId: number;
  sceneIndex: number;
}): Promise<string> {
  const { imageUrl, orderId, sceneIndex } = params;

  try {
    // Download the scene image (resolve relative /manus-storage/ paths first)
    const resolvedUrl = await resolveUrl(imageUrl);
    const imageResponse = await fetch(resolvedUrl);
    if (!imageResponse.ok) throw new Error(`Failed to download image: ${imageResponse.status}`);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // Create a text watermark using SVG
    const watermarkSize = Math.round(Math.min(width, height) * 0.08);
    const padding = Math.round(watermarkSize * 0.5);
    const svgWatermark = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <text
          x="${width - padding}"
          y="${height - padding}"
          font-family="Arial, sans-serif"
          font-size="${watermarkSize}px"
          font-weight="bold"
          fill="rgba(255,255,255,0.6)"
          text-anchor="end"
          dominant-baseline="auto"
        >KidzRstarz</text>
      </svg>
    `);

    // Composite watermark onto image
    const watermarkedBuffer = await sharp(imageBuffer)
      .composite([{ input: svgWatermark, blend: "over" }])
      .jpeg({ quality: 90 })
      .toBuffer();

    const key = `orders/${orderId}/scenes/scene_${sceneIndex}_watermarked.jpg`;
    const { url } = await storagePut(key, watermarkedBuffer, "image/jpeg");
    return url;
  } catch (err) {
    console.error("[Watermark] Failed to apply watermark:", err);
    // Return original URL if watermarking fails
    return imageUrl;
  }
}

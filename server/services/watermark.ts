import sharp from "sharp";

/**
 * Apply a "KidzRstarz" watermark to an image buffer.
 * The watermark is a semi-transparent diagonal text overlay
 * that protects content while keeping the image viewable.
 *
 * @param imageBuffer - The original image as a Buffer
 * @returns A new Buffer with the watermark applied
 */
export async function applyWatermark(imageBuffer: Buffer): Promise<Buffer> {
  try {
    // Get image dimensions
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    // Create SVG watermark overlay with repeating diagonal text
    const watermarkSvg = generateWatermarkSvg(width, height);

    // Composite the watermark onto the image
    const watermarkedBuffer = await sharp(imageBuffer)
      .composite([
        {
          input: Buffer.from(watermarkSvg),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    return watermarkedBuffer;
  } catch (error) {
    console.error("[Watermark] Error applying watermark:", error);
    // Return original image if watermarking fails
    return imageBuffer;
  }
}

/**
 * Generate an SVG watermark overlay with repeating diagonal "KidzRstarz" text.
 * Uses a tiled pattern for comprehensive coverage.
 */
function generateWatermarkSvg(width: number, height: number): string {
  // Calculate font size relative to image dimensions (roughly 3-4% of the smaller dimension)
  const baseDimension = Math.min(width, height);
  const fontSize = Math.max(24, Math.round(baseDimension * 0.04));
  const spacing = fontSize * 5; // Space between watermark repetitions

  // Build the repeated text elements with diagonal rotation
  let textElements = "";
  for (let y = -height; y < height * 2; y += spacing) {
    for (let x = -width; x < width * 2; x += spacing * 2) {
      textElements += `<text
        x="${x}" y="${y}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="white"
        fill-opacity="0.15"
        transform="rotate(-30, ${x}, ${y})"
      >KidzRstarz</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <style>
        text { user-select: none; pointer-events: none; }
      </style>
    </defs>
    ${textElements}
  </svg>`;
}

/**
 * Apply a smaller, single-corner watermark for paid/final images.
 * This is a subtle brand mark rather than a content-protection watermark.
 *
 * @param imageBuffer - The original image as a Buffer
 * @returns A new Buffer with a subtle brand watermark
 */
export async function applyBrandWatermark(imageBuffer: Buffer): Promise<Buffer> {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width || 1024;
    const height = metadata.height || 1024;

    const fontSize = Math.max(16, Math.round(Math.min(width, height) * 0.025));
    const padding = Math.round(fontSize * 0.8);

    const brandSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <text
        x="${width - padding}" y="${height - padding}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${fontSize}"
        font-weight="bold"
        fill="white"
        fill-opacity="0.4"
        text-anchor="end"
      >KidzRstarz</text>
    </svg>`;

    const watermarkedBuffer = await sharp(imageBuffer)
      .composite([
        {
          input: Buffer.from(brandSvg),
          top: 0,
          left: 0,
        },
      ])
      .png()
      .toBuffer();

    return watermarkedBuffer;
  } catch (error) {
    console.error("[Watermark] Error applying brand watermark:", error);
    return imageBuffer;
  }
}

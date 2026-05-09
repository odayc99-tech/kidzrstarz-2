import { generateImage } from "../_core/imageGeneration";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { applyWatermark } from "./watermark";
import { getStorageNamespace } from "./storageNamespace";

/**
 * Generate a low-resolution preview of the Pixar-style character.
 * Used for checkout preview before payment.
 * The prompt is crafted to ensure a true 3D Pixar transformation.
 * 
 * @param childDescription - Optional description of the child to improve accuracy.
 */
export async function generatePreviewImage(
  originalImageUrl: string,
  childName: string,
  userId: number | null,
  orderId: number,
  childDescription?: string | null
): Promise<{ imageUrl: string; imageKey: string }> {
  try {
    console.log(`[PreviewGeneration] Starting preview generation for ${childName}`);

    // Build description section if provided
    const descriptionSection = childDescription
      ? `\nPhysical description of the child (use these details to make the character more accurate):
${childDescription}
Incorporate these physical traits into the 3D character while maintaining the Pixar animation style.`
      : "";

    // Strong transformation prompt — must produce a 3D cartoon, not a filtered photo
    const prompt = `IMPORTANT: Completely re-create and transform the person in this photo into a fully 3D-rendered Pixar/Disney-style animated character. Do NOT keep the original photograph — generate a brand-new 3D cartoon illustration from scratch based on the person's likeness.

Requirements:
- Full 3D CGI render in the style of Pixar Animation Studios (like characters from Coco, Inside Out, Toy Story, or Up)
- Exaggerated cartoon proportions: large expressive eyes, smooth rounded features, stylized hair
- Vibrant, saturated color palette typical of Pixar films
- Soft ambient lighting with subtle rim light
- Clean, soft gradient or colorful fantasy background (NOT the original photo background)
- The character should clearly resemble the child in the photo but rendered entirely as a 3D animated character
- This is a preview image — standard quality is fine
${descriptionSection}
Character name: ${childName}`;

    const result = await generateImage({
      prompt,
      originalImages: [
        {
          url: originalImageUrl,
          mimeType: "image/jpeg",
        },
      ],
    });

    if (!result.url) {
      throw new Error("Preview image generation returned no URL");
    }

    // Download the generated preview and upload to S3
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch preview image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();

    // Apply KidzRstarz watermark to preview image (content protection)
    const watermarkedBuffer = await applyWatermark(Buffer.from(buffer));

    // Upload watermarked preview to S3
    const ns = getStorageNamespace(userId, orderId);
    const fileKey = `${ns}/previews/${nanoid()}-preview.png`;
    const { url: s3Url } = await storagePut(
      fileKey,
      watermarkedBuffer,
      "image/png"
    );

    console.log(
      `[PreviewGeneration] Successfully generated and stored preview for ${childName}`
    );

    return {
      imageUrl: s3Url,
      imageKey: fileKey,
    };
  } catch (error) {
    console.error("[PreviewGeneration] Error generating preview:", error);
    throw error;
  }
}

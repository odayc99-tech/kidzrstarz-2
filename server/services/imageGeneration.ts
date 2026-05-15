import { generateImage } from "../_core/imageGeneration";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import { applyBrandWatermark } from "./watermark";
import { getStorageNamespace } from "./storageNamespace";

/**
 * Generate a 3D animated character image from an original photo.
 * The prompt is crafted to ensure the AI actually transforms the child
 * into a 3D animated character rather than returning the original photo.
 * 
 * @param childDescription - Optional description of the child (height, build, hair, etc.)
 *                           to improve character accuracy.
 */
export async function generatePixarCharacter(
  originalImageUrl: string,
  childName: string,
  userId: number | null,
  orderId: number,
  childDescription?: string | null
): Promise<{ imageUrl: string; imageKey: string }> {
  try {
    console.log(`[ImageGeneration] Starting 3D animated character transformation for ${childName}`);

    // Build description section if provided
    const descriptionSection = childDescription
      ? `\nPhysical description of the child (use these details to make the character more accurate):
${childDescription}
Incorporate these physical traits into the 3D character while maintaining the cinematic 3D animation style.`
      : "";

    // Highly specific prompt that instructs the model to TRANSFORM the photo
    const prompt = `IMPORTANT: Completely re-create and transform the person in this photo into a fully 3D-rendered cinematic animated character. Do NOT keep the original photograph — generate a brand-new 3D cartoon illustration from scratch based on the person's likeness.

Requirements:
- Full 3D CGI render in a premium cinematic animation style (expressive, vibrant, movie-quality)
- Exaggerated cartoon proportions: large expressive eyes, smooth rounded features, stylized hair
- Vibrant, saturated color palette typical of high-end animated films
- Soft ambient lighting with subtle rim light, as seen in animated movie posters
- Clean, soft gradient or colorful fantasy background (NOT the original photo background)
- The character should clearly resemble the child in the photo but rendered entirely as a 3D animated character
- Professional animation studio quality, suitable for a movie poster
- The final image must look like a screenshot from a premium animated movie, NOT a photograph with filters
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
      throw new Error("Image generation returned no URL");
    }

    // Download the generated image and upload to S3
    const response = await fetch(result.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch generated image: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();

    // Apply subtle KidzRstarz brand watermark to final image
    const brandedBuffer = await applyBrandWatermark(Buffer.from(buffer));

    // Upload to S3 with user/order-specific path
    const ns = getStorageNamespace(userId, orderId);
    const fileKey = `${ns}/generated/${nanoid()}-animated-character.png`;
    const { url: s3Url } = await storagePut(
      fileKey,
      brandedBuffer,
      "image/png"
    );

    console.log(
      `[ImageGeneration] Successfully generated and stored image for ${childName}`
    );

    return {
      imageUrl: s3Url,
      imageKey: fileKey,
    };
  } catch (error) {
    console.error("[ImageGeneration] Error generating animated character:", error);
    throw error;
  }
}

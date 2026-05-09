import { generatePreviewImage } from "../services/previewGeneration";
import { updateOrderWithPreview, getOrderById } from "../db";

/**
 * Process preview image generation for an order
 * This is called immediately after order creation, before payment
 */
export async function processPreviewGeneration(orderId: number): Promise<void> {
  try {
    console.log(`[PreviewJob] Starting preview generation for order ${orderId}`);

    const order = await getOrderById(orderId);
    if (!order) {
      console.error(`[PreviewJob] Order ${orderId} not found`);
      return;
    }

    // Generate the preview image (with child description for accuracy)
    const { imageUrl, imageKey } = await generatePreviewImage(
      order.originalImageUrl,
      order.childName || "Child",
      order.userId,
      orderId,
      order.childDescription
    );

    // Update order with preview image
    await updateOrderWithPreview(orderId, {
      previewImageKey: imageKey,
      previewImageUrl: imageUrl,
    });

    console.log(`[PreviewJob] Successfully completed preview generation for order ${orderId}`);
  } catch (error) {
    console.error(`[PreviewJob] Error processing preview for order ${orderId}:`, error);
    // Don't fail the order if preview generation fails - it's not critical
    // User can still proceed to payment
  }
}

/**
 * Schedule preview generation with a small delay
 */
export async function schedulePreviewGeneration(orderId: number): Promise<void> {
  // Start preview generation immediately but don't block
  setTimeout(() => {
    processPreviewGeneration(orderId).catch(console.error);
  }, 500);
}

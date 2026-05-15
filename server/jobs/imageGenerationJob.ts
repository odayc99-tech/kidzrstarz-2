import { generatePixarCharacter } from "../services/imageGeneration";
import { updateOrderWithImage, getOrderById, getUserByOpenId } from "../db";
import { notifyOwner } from "../_core/notification";
import { scheduleVideoGeneration } from "./videoGenerationJob";

/**
 * Process image generation for a paid order
 * This should be called after payment is confirmed
 */
export async function processImageGeneration(orderId: number): Promise<void> {
  try {
    console.log(`[Job] Starting image generation for order ${orderId}`);

    const order = await getOrderById(orderId);
    if (!order) {
      console.error(`[Job] Order ${orderId} not found`);
      return;
    }

    if (order.paymentStatus !== "paid") {
      console.warn(
        `[Job] Order ${orderId} payment not confirmed, skipping generation`
      );
      return;
    }

    // Update order status to processing
    await updateOrderWithImage(orderId, {
      generatedImageKey: "",
      generatedImageUrl: "",
      status: "processing",
    });

    // Generate the 3D animated character image (with child description for accuracy)
    const { imageUrl, imageKey } = await generatePixarCharacter(
      order.originalImageUrl,
      order.childName || "Child",
      order.userId,
      orderId,
      order.childDescription
    );

    // Update order with generated image
    await updateOrderWithImage(orderId, {
      generatedImageKey: imageKey,
      generatedImageUrl: imageUrl,
      status: "completed",
    });

    console.log(`[Job] Successfully completed image generation for order ${orderId}`);

    // Only trigger video generation if story has been approved by the user
    const updatedOrder = await getOrderById(orderId);
    if (updatedOrder?.storyApproved) {
      console.log(`[Job] Story approved, triggering video generation for order ${orderId}`);
      scheduleVideoGeneration(orderId);
    } else {
      console.log(`[Job] Story not yet approved for order ${orderId}, video generation will start after approval`);
    }

    // Notify owner of successful generation (non-blocking — don't let notification failure corrupt order status)
    notifyOwner({
      title: `KidzRstarz: Image Generated (Order #${orderId})`,
      content: `User received their 3D animated character image for order #${orderId}.${updatedOrder?.storyApproved ? ' Video generation started.' : ' Awaiting story approval for video.'}`,
    }).catch((e) => console.warn(`[Job] Failed to notify owner for order ${orderId}:`, e));
  } catch (error) {
    console.error(`[Job] Error processing image generation for order ${orderId}:`, error);

    // Update order with error status
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";
    await updateOrderWithImage(orderId, {
      generatedImageKey: "",
      generatedImageUrl: "",
      status: "failed",
    });

    // Notify owner of failure
    await notifyOwner({
      title: `KidzRstarz: Image Generation Failed (Order #${orderId})`,
      content: `Failed to generate image for order #${orderId}: ${errorMessage}`,
    }).catch(console.error);
  }
}

/**
 * Simulate immediate image generation for demo purposes
 * In production, this would be triggered by a job queue (Bull, RabbitMQ, etc.)
 */
export async function scheduleImageGeneration(orderId: number): Promise<void> {
  // Simulate a small delay before starting generation
  setTimeout(() => {
    processImageGeneration(orderId).catch(console.error);
  }, 2000);
}

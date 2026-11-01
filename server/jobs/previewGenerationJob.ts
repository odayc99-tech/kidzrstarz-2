import { and, eq, isNull, like, or } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { generatePreviewImage } from "../services/previewGeneration";
import { updateOrderWithPreview, getOrderById, getDb } from "../db";

// Prevent concurrent generation of more than one preview for the same order.
const activePreviewJobs = new Set<number>();
const scheduledPreviewJobs = new Set<number>();

export function isPreviewGenerating(orderId: number): boolean {
  return activePreviewJobs.has(orderId) || scheduledPreviewJobs.has(orderId);
}

function sanitizedPreviewError(): string {
  // Never copy provider, storage, or request details into the order record: those
  // details can contain URLs, credentials, or child-image metadata.
  return "Preview: generation failed. Please try again.";
}

async function persistPreviewError(orderId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) {
      console.warn(`[PreviewJob] Database unavailable; could not save preview error for order ${orderId}`);
      return;
    }

    await db
      .update(orders)
      .set({ errorMessage: sanitizedPreviewError() })
      .where(and(
        eq(orders.id, orderId),
        isNull(orders.previewImageKey),
        or(isNull(orders.errorMessage), like(orders.errorMessage, "Preview: %"))
      ));
  } catch (dbError) {
    // A non-critical preview error must never become an order/payment failure.
    console.error(`[PreviewJob] Failed to save preview error for order ${orderId}:`, dbError);
  }
}

async function clearRecoveredPreviewError(
  orderId: number,
  errorMessage: string | null
): Promise<void> {
  if (!errorMessage?.startsWith("Preview: ")) return;

  try {
    const db = await getDb();
    if (!db) return;

    // Keep the condition in SQL as well as the in-memory check so a concurrent
    // non-preview job error cannot be erased after this worker read the order.
    await db
      .update(orders)
      .set({ errorMessage: null })
      .where(
        and(
          eq(orders.id, orderId),
          like(orders.errorMessage, "Preview: %")
        )
      );
  } catch (dbError) {
    // The preview has already been stored; failing to clear a stale display error
    // is non-critical and should not mark the overall order as failed.
    console.error(`[PreviewJob] Failed to clear preview error for order ${orderId}:`, dbError);
  }
}

/**
 * Process preview image generation for an order.
 * This is called immediately after order creation, before payment.
 */
export async function processPreviewGeneration(orderId: number): Promise<void> {
  if (activePreviewJobs.has(orderId)) {
    console.log(`[PreviewJob] Preview generation already in progress for order ${orderId}, skipping duplicate`);
    return;
  }

  activePreviewJobs.add(orderId);
  try {
    console.log(`[PreviewJob] Starting preview generation for order ${orderId}`);

    const order = await getOrderById(orderId);
    if (!order) {
      console.error(`[PreviewJob] Order ${orderId} not found`);
      return;
    }

    if (order.previewImageKey) {
      console.log(`[PreviewJob] Preview already exists for order ${orderId}, skipping generation`);
      return;
    }

    // Generate the preview image (with child description for accuracy).
    const { imageUrl, imageKey } = await generatePreviewImage(
      order.originalImageUrl,
      order.childName || "Child",
      order.userId,
      orderId,
      order.childDescription,
      order.originalImageKey
    );

    // Update only preview fields; preview failure must not affect payment/status.
    await updateOrderWithPreview(orderId, {
      previewImageKey: imageKey,
      previewImageUrl: imageUrl,
    });
    await clearRecoveredPreviewError(orderId, order.errorMessage);

    console.log(`[PreviewJob] Successfully completed preview generation for order ${orderId}`);
  } catch (error) {
    console.error(`[PreviewJob] Error processing preview for order ${orderId}:`, error);
    await persistPreviewError(orderId);
    // Preview generation is non-critical: callers must not treat this as an order
    // or payment failure.
  } finally {
    activePreviewJobs.delete(orderId);
  }
}

/**
 * Schedule preview generation with a small delay.
 */
export async function schedulePreviewGeneration(orderId: number): Promise<void> {
  if (isPreviewGenerating(orderId)) {
    console.log(`[PreviewJob] Preview generation already scheduled or in progress for order ${orderId}, skipping duplicate`);
    return;
  }

  scheduledPreviewJobs.add(orderId);
  // Start preview generation shortly without blocking the order flow.
  setTimeout(() => {
    scheduledPreviewJobs.delete(orderId);
    processPreviewGeneration(orderId).catch(console.error);
  }, 500);
}

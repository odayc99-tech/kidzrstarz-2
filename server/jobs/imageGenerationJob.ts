import { and, eq, inArray, isNull, like, lt, or } from "drizzle-orm";
import { orders } from "../../drizzle/schema";
import { generatePixarCharacter } from "../services/imageGeneration";
import { getDb, getOrderById } from "../db";
import { notifyOwner } from "../_core/notification";
import { scheduleVideoGeneration } from "./videoGenerationJob";

const IMAGE_PROCESSING_LEASE_MS = 30 * 60 * 1000;
const activeImageJobs = new Set<number>();
const scheduledImageJobs = new Set<number>();
const IMAGE_ERROR_PREFIX = "Image: ";
const IMAGE_ERROR_MESSAGE = "Image: generation failed. Please try again.";

type ImageGenerationClaim = {
  updatedAt: Date;
};

/** Exposed for status/UI callers and focused duplicate-delivery tests. */
export function isImageGenerating(orderId: number): boolean {
  return activeImageJobs.has(orderId) || scheduledImageJobs.has(orderId);
}

function affectedRows(result: unknown): number {
  const mysqlResult = Array.isArray(result) ? result[0] : result;
  if (!mysqlResult || typeof mysqlResult !== "object") return 0;

  const value = (mysqlResult as { affectedRows?: unknown }).affectedRows;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Claim an image job using only existing order fields. A fresh processing row is
 * owned by another worker; a processing row older than the lease is recoverable.
 */
async function claimPaidImageGeneration(orderId: number): Promise<ImageGenerationClaim | null> {
  const db = await getDb();
  if (!db) {
    console.warn(`[Job] Database unavailable; image generation was not claimed for order ${orderId}`);
    return null;
  }

  const staleBefore = new Date(Date.now() - IMAGE_PROCESSING_LEASE_MS);
  const claimResult = await db
    .update(orders)
    .set({ status: "processing" })
    .where(
      and(
        eq(orders.id, orderId),
        eq(orders.paymentStatus, "paid"),
        isNull(orders.generatedImageKey),
        or(
          inArray(orders.status, ["pending", "failed"]),
          and(eq(orders.status, "processing"), lt(orders.updatedAt, staleBefore))
        )
      )
    );

  // Drizzle's MySQL driver exposes the ResultSetHeader from which affectedRows
  // must be checked. Do not launch a provider request without this durable CAS.
  if (affectedRows(claimResult) !== 1) {
    console.log(`[Job] Image generation claim was not acquired for order ${orderId}`);
    return null;
  }

  // Capture the DB-maintained updatedAt fence after the claim. Completion/error
  // writes use it so a stale worker cannot overwrite a subsequently reclaimed job.
  const claimedOrder = await getOrderById(orderId);
  if (
    !claimedOrder ||
    claimedOrder.paymentStatus !== "paid" ||
    claimedOrder.status !== "processing" ||
    claimedOrder.generatedImageKey ||
    !claimedOrder.updatedAt
  ) {
    console.warn(`[Job] Claim state changed before image generation for order ${orderId}`);
    return null;
  }

  return { updatedAt: claimedOrder.updatedAt };
}

async function persistImageError(
  orderId: number,
  claim: ImageGenerationClaim
): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    await db
      .update(orders)
      .set({ status: "failed", errorMessage: IMAGE_ERROR_MESSAGE })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.paymentStatus, "paid"),
          eq(orders.status, "processing"),
          isNull(orders.generatedImageKey),
          eq(orders.updatedAt, claim.updatedAt),
          or(isNull(orders.errorMessage), like(orders.errorMessage, `${IMAGE_ERROR_PREFIX}%`))
        )
      );
  } catch (dbError) {
    // Preserve the payment and any generated asset even if this best-effort,
    // safe display-error write cannot be made.
    console.error(`[Job] Failed to save image error for order ${orderId}:`, dbError);
  }
}

async function clearRecoveredImageError(orderId: number): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    // Only clear an error owned by this worker category. A concurrent video or
    // story error must remain visible after a successful image generation.
    await db
      .update(orders)
      .set({ errorMessage: null })
      .where(and(eq(orders.id, orderId), like(orders.errorMessage, `${IMAGE_ERROR_PREFIX}%`)));
  } catch (dbError) {
    console.error(`[Job] Failed to clear recovered image error for order ${orderId}:`, dbError);
  }
}

/**
 * Process image generation for a paid order. The in-memory guard handles local
 * callbacks while the conditional database update protects across processes.
 */
export async function processImageGeneration(orderId: number): Promise<void> {
  if (activeImageJobs.has(orderId)) {
    console.log(`[Job] Image generation already in progress for order ${orderId}, skipping duplicate`);
    return;
  }

  activeImageJobs.add(orderId);
  let claim: ImageGenerationClaim | null = null;

  try {
    console.log(`[Job] Starting image generation for order ${orderId}`);

    const order = await getOrderById(orderId);
    if (!order) {
      console.error(`[Job] Order ${orderId} not found`);
      return;
    }

    if (order.paymentStatus !== "paid") {
      console.warn(`[Job] Order ${orderId} payment not confirmed, skipping generation`);
      return;
    }

    if (order.generatedImageKey) {
      console.log(`[Job] Generated image already exists for order ${orderId}, skipping generation`);
      // An image-ready duplicate must never reset status back to completed: the
      // video worker may already own a processing claim. Its guarded scheduler
      // is the only safe recovery path, and existing video media is final.
      if (order.storyApproved && !order.videoKey) {
        scheduleVideoGeneration(orderId);
      }
      return;
    }

    claim = await claimPaidImageGeneration(orderId);
    if (!claim) return;

    // Generate the 3D animated character image using the canonical original key
    // whenever it exists. The service only falls back to the legacy URL if absent.
    const { imageUrl, imageKey } = await generatePixarCharacter(
      order.originalImageUrl,
      order.childName || "Child",
      order.userId,
      orderId,
      order.childDescription,
      order.originalImageKey
    );

    const db = await getDb();
    if (!db) {
      throw new Error("Database unavailable while storing generated image");
    }

    const completeResult = await db
      .update(orders)
      .set({
        generatedImageKey: imageKey,
        generatedImageUrl: imageUrl,
        status: "completed",
      })
      .where(
        and(
          eq(orders.id, orderId),
          eq(orders.paymentStatus, "paid"),
          eq(orders.status, "processing"),
          isNull(orders.generatedImageKey),
          eq(orders.updatedAt, claim.updatedAt)
        )
      );

    if (affectedRows(completeResult) !== 1) {
      console.warn(`[Job] Image completion state changed for order ${orderId}; preserving current order state`);
      return;
    }

    await clearRecoveredImageError(orderId);
    console.log(`[Job] Successfully completed image generation for order ${orderId}`);

    const updatedOrder = await getOrderById(orderId);
    if (
      updatedOrder?.paymentStatus === "paid" &&
      updatedOrder.generatedImageKey &&
      updatedOrder.storyApproved &&
      !updatedOrder.videoKey
    ) {
      console.log(`[Job] Story approved, triggering video generation for order ${orderId}`);
      scheduleVideoGeneration(orderId);
    } else {
      console.log(`[Job] Video generation is waiting for a paid image and story approval for order ${orderId}`);
    }

    // Notification failure must not corrupt generation state.
    notifyOwner({
      title: `KidzRstarz: Image Generated (Order #${orderId})`,
      content: `User received their 3D animated character image for order #${orderId}.${updatedOrder?.storyApproved ? " Video generation started." : " Awaiting story approval for video."}`,
    }).catch((notificationError) =>
      console.warn(`[Job] Failed to notify owner for order ${orderId}:`, notificationError)
    );
  } catch (error) {
    console.error(`[Job] Error processing image generation for order ${orderId}:`, error);

    if (claim) {
      await persistImageError(orderId, claim);
    }

    // Notification failure must remain non-blocking and contains provider detail
    // only in server logs, never in the persisted customer-visible error.
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    notifyOwner({
      title: `KidzRstarz: Image Generation Failed (Order #${orderId})`,
      content: `Failed to generate image for order #${orderId}: ${errorMessage}`,
    }).catch((notificationError) =>
      console.warn(`[Job] Failed to notify owner about image failure for order ${orderId}:`, notificationError)
    );
  } finally {
    activeImageJobs.delete(orderId);
  }
}

/**
 * Queue image generation without blocking payment callbacks. Queued and active
 * sets collapse repeated webhook and browser-return callbacks in this process.
 */
export async function scheduleImageGeneration(orderId: number): Promise<void> {
  if (isImageGenerating(orderId)) {
    console.log(`[Job] Image generation already queued or active for order ${orderId}, skipping duplicate`);
    return;
  }

  scheduledImageJobs.add(orderId);
  setTimeout(() => {
    scheduledImageJobs.delete(orderId);
    processImageGeneration(orderId).catch((error) =>
      console.error(`[Job] Unhandled image generation error for order ${orderId}:`, error)
    );
  }, 2000);
}

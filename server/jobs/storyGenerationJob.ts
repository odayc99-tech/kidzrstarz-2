import { generateStory } from "../services/storyGeneration";
import { getOrderById, getDb } from "../db";
import { orders } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

export async function processStoryGeneration(orderId: number): Promise<void> {
  try {
    console.log(`[StoryJob] Starting story generation for order ${orderId}`);

    const order = await getOrderById(orderId);
    if (!order) {
      console.error(`[StoryJob] Order ${orderId} not found`);
      return;
    }

    // Generate the story (include child description and theme for accuracy)
    const characterDesc = order.childDescription
      ? `a magical 3D Pixar-style character who ${order.childDescription}`
      : "a magical 3D Pixar-style character";

    const story = await generateStory({
      childName: order.childName || "Your Character",
      characterDescription: characterDesc,
      theme: order.storyTheme || "adventure",
    });

    // Update the order with the generated story
    const db = await getDb();
    if (db) {
      await db.update(orders).set({ story }).where(eq(orders.id, orderId));
    }

    console.log(`[StoryJob] Story generated successfully for order ${orderId} with theme: ${order.storyTheme || "adventure"}`);
  } catch (error) {
    console.error(`[StoryJob] Error generating story for order ${orderId}:`, error);
    // Notify owner about story generation failure
    try {
      const errMsg = error instanceof Error ? error.message : String(error);
      await notifyOwner({
        title: `\u26a0\ufe0f KidzRstarz: Story Generation Failed - Order #${orderId}`,
        content: `Story generation failed for order #${orderId}.\n\nError: ${errMsg.substring(0, 400)}\n\nThe user can retry by clicking "Regenerate Story" on the checkout page.`,
      });
    } catch (notifyErr) {
      console.warn(`[StoryJob] Failed to send failure notification:`, notifyErr);
    }
  }
}

/**
 * Schedule story generation with a small delay
 */
export async function scheduleStoryGeneration(orderId: number): Promise<void> {
  // Start story generation immediately but don't block
  setTimeout(() => {
    processStoryGeneration(orderId).catch(console.error);
  }, 1000);
}

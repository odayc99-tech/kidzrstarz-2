import { generateStory } from "../services/storyGeneration";
import { getOrderById, getDb } from "../db";
import { orders } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

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
      ? `a magical 3D animated character who ${order.childDescription}`
      : "a magical 3D animated character";

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
    // Don't fail the job - story generation is not critical
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

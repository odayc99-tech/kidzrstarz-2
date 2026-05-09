/**
 * Backfill: trigger scene + video generation for paid orders with pending scenes.
 * Run: cd /home/ubuntu/kidzrstarz && npx tsx scripts/backfill.ts
 */
import { runSceneGeneration, runVideoGeneration } from "../server/jobs/storybookJob";
import { getDb } from "../server/db";
import { orders, storyScenes } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  // Find paid orders with pending scenes
  const paidOrders = await db
    .selectDistinct({ id: orders.id, childName: orders.childName })
    .from(orders)
    .innerJoin(storyScenes, eq(storyScenes.orderId, orders.id))
    .where(and(eq(orders.paymentStatus, "paid"), eq(storyScenes.status, "pending")));

  console.log(`Found ${paidOrders.length} paid orders with pending scenes:`, paidOrders.map(o => o.id));

  for (const order of paidOrders) {
    console.log(`\n[Backfill] Starting scene generation for order ${order.id} (${order.childName})...`);
    try {
      await runSceneGeneration(order.id);
      console.log(`[Backfill] Scene generation complete for order ${order.id}, starting video...`);
      await runVideoGeneration(order.id);
      console.log(`[Backfill] Video generation complete for order ${order.id}`);
    } catch (err) {
      console.error(`[Backfill] Failed for order ${order.id}:`, err);
    }
  }

  console.log("\n[Backfill] Done.");
  process.exit(0);
}

main().catch(err => {
  console.error("[Backfill] Fatal error:", err);
  process.exit(1);
});

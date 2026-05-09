import { eq, desc, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, orders, InsertOrder } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get user by internal numeric ID
 */
export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

/**
 * Create a new order
 */
export async function createOrder(order: InsertOrder) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  try {
    const insertResult = await db.insert(orders).values(order);
    
    let insertedId = (insertResult as any).insertId;
    
    if (!insertedId || !Number.isFinite(insertedId)) {
      console.warn("[DB] insertId not found in result, querying database");
      
      // Fallback: query by guestToken or userId
      let queryResult;
      if (order.guestToken) {
        queryResult = await db
          .select()
          .from(orders)
          .where(eq(orders.guestToken, order.guestToken))
          .orderBy(desc(orders.id))
          .limit(1);
      } else if (order.userId) {
        queryResult = await db
          .select()
          .from(orders)
          .where(eq(orders.userId, order.userId))
          .orderBy(desc(orders.id))
          .limit(1);
      }
      
      if (!queryResult || queryResult.length === 0) {
        throw new Error("Failed to retrieve inserted order from database");
      }
      
      insertedId = queryResult[0].id;
    }
    
    if (!insertedId || !Number.isFinite(insertedId)) {
      throw new Error("Failed to retrieve inserted order ID");
    }
    
    return {
      insertId: insertedId,
      affectedRows: (insertResult as any).affectedRows || 1,
    };
  } catch (error) {
    console.error("[DB] Error creating order:", error);
    throw error;
  }
}

/**
 * Get order by ID
 */
export async function getOrderById(orderId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/**
 * Update order status and payment info
 */
export async function updateOrderPayment(orderId: number, updates: {
  paymentStatus: "unpaid" | "paid" | "refunded";
  stripePaymentIntentId?: string;
  paidAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(orders)
    .set({
      paymentStatus: updates.paymentStatus,
      stripePaymentIntentId: updates.stripePaymentIntentId,
      paidAt: updates.paidAt,
    })
    .where(eq(orders.id, orderId));
}

/**
 * Update order with generated image
 */
export async function updateOrderWithImage(orderId: number, updates: {
  generatedImageKey?: string;
  generatedImageUrl?: string;
  status?: "pending" | "processing" | "completed" | "failed";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const setData: any = {};
  if (updates.generatedImageKey !== undefined) setData.generatedImageKey = updates.generatedImageKey;
  if (updates.generatedImageUrl !== undefined) setData.generatedImageUrl = updates.generatedImageUrl;
  if (updates.status !== undefined) setData.status = updates.status;
  
  await db.update(orders)
    .set(setData)
    .where(eq(orders.id, orderId));
}

/**
 * Update order with preview image
 */
export async function updateOrderWithPreview(orderId: number, updates: {
  previewImageKey?: string;
  previewImageUrl?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(orders)
    .set({
      previewImageKey: updates.previewImageKey,
      previewImageUrl: updates.previewImageUrl,
    })
    .where(eq(orders.id, orderId));
}

/**
 * Update the story text for an order
 */
export async function updateOrderStory(orderId: number, story: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(orders)
    .set({ story })
    .where(eq(orders.id, orderId));
}

/**
 * Get all orders for a user
 */
export async function getUserOrders(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(orders).where(eq(orders.userId, userId));
  return result;
}

/**
 * Get order by guest token
 */
export async function getOrderByGuestToken(guestToken: string) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select().from(orders).where(eq(orders.guestToken, guestToken)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/**
 * Get orders by multiple guest tokens (for guest My Orders page)
 */
export async function getOrdersByGuestTokens(guestTokens: string[]) {
  if (guestTokens.length === 0) return [];
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(orders)
    .where(inArray(orders.guestToken, guestTokens))
    .orderBy(desc(orders.createdAt));
  return result;
}

/**
 * Claim guest orders: assign userId to orders matching the given guest tokens.
 * Returns the number of orders claimed.
 */
export async function claimGuestOrders(userId: number, guestTokens: string[]): Promise<number> {
  if (guestTokens.length === 0) return 0;
  const db = await getDb();
  if (!db) return 0;

  // Only claim orders that still have no userId (prevent double-claiming)
  // We update in a loop to count accurately
  let claimed = 0;
  for (const token of guestTokens) {
    const order = await db
      .select()
      .from(orders)
      .where(eq(orders.guestToken, token))
      .limit(1);

    if (order.length > 0 && order[0].userId === null) {
      await db
        .update(orders)
        .set({ userId, guestToken: null })
        .where(eq(orders.guestToken, token));
      claimed++;
    }
  }

  return claimed;
}

/**
 * Get all orders (admin)
 */
export async function getAllOrders() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(orders).orderBy(desc(orders.createdAt));
  return result;
}

/**
 * Get a paid order by its share token (for public share-based downloads)
 */
export async function getOrderByShareToken(shareToken: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.shareToken, shareToken))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, publicProcedure } from "../_core/trpc";
import {
  createOrder,
  getOrderById,
  getUserOrders,
  updateOrderPayment,
  updateOrderWithImage,
  updateOrderStory,
  getAllOrders,
  getDb,
  getOrderByGuestToken,
  getOrdersByGuestTokens,
  claimGuestOrders as claimGuestOrdersDb,
} from "../db";
import { storyScenes, orders } from "../../drizzle/schema";
import { eq, asc, desc, sql, and, isNotNull, not } from "drizzle-orm";
import { storagePut, storageGet, storageUpdateMetadata } from "../storage";
import { nanoid } from "nanoid";
import { PRODUCTS } from "../stripe-products";
import { schedulePreviewGeneration } from "../jobs/previewGenerationJob";
import { scheduleStoryGeneration } from "../jobs/storyGenerationJob";
import { scheduleVideoGeneration, isVideoGenerating } from "../jobs/videoGenerationJob";
import { scheduleImageGeneration } from "../jobs/imageGenerationJob";
import { getAvailableVoices } from "../services/ttsService";
import { getAvailableThemes } from "../services/storyGeneration";
import { getStorageNamespace } from "../services/storageNamespace";
import Stripe from "stripe";

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

/**
 * Helper: Refresh a pre-signed S3 URL using the stored key.
 * Returns a fresh 6-hour pre-signed URL, or the original url if no key.
 */
async function refreshUrl(key: string | null | undefined, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (!key) return url; // No key stored — return as-is (legacy or external URL)
  try {
    const { url: freshUrl } = await storageGet(key, 21600); // 6 hours
    return freshUrl;
  } catch {
    return url; // Fall back to stored URL if refresh fails
  }
}

/**
 * Helper: Verify order access for either logged-in user or guest token.
 * Returns the order if authorized, throws otherwise.
 */
async function verifyOrderAccess(
  orderId: number,
  userId: number | null | undefined,
  guestToken: string | null | undefined
) {
  const order = await getOrderById(orderId);
  if (!order) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  }

  // Logged-in user owns the order
  if (userId && order.userId === userId) {
    return order;
  }

  // Guest token matches
  if (guestToken && order.guestToken === guestToken) {
    return order;
  }

  throw new TRPCError({
    code: "NOT_FOUND",
    message: "Order not found or unauthorized",
  });
}

export const ordersRouter = router({
  /**
   * Get available story themes (public - no auth required)
   */
  getThemes: publicProcedure.query(() => {
    return getAvailableThemes();
  }),

  /**
   * Get available TTS voices (public - no auth required)
   */
  getVoices: publicProcedure.query(() => {
    return getAvailableVoices();
  }),

  /**
   * Upload a voice sample for voice cloning (supports guest + auth)
   */
  uploadVoiceSample: publicProcedure
    .input(
      z.object({
        orderId: z.number(),
        guestToken: z.string().optional(),
        audioBase64: z.string(),
        mimeType: z.string().default("audio/webm"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      // Decode base64 and upload to S3
      const buffer = Buffer.from(input.audioBase64, "base64");
      const ext = input.mimeType.includes("mp3") ? "mp3" : input.mimeType.includes("wav") ? "wav" : "webm";
      const ns = getStorageNamespace(order.userId, order.id);
      const fileKey = `${ns}/voice-samples/${nanoid()}-voice.${ext}`;

      const { url: voiceUrl } = await storagePut(
        fileKey,
        buffer,
        input.mimeType
      );

      // Update order with voice sample
      const db = await getDb();
      if (db) {
        await db.update(orders)
          .set({ voiceSampleKey: fileKey, voiceSampleUrl: voiceUrl })
          .where(eq(orders.id, input.orderId));
      }

      return {
        success: true,
        voiceUrl,
        message: "Voice sample uploaded successfully. It will be used for narration.",
      };
    }),

  /**
   * Create an order (supports guest + auth).
   * If the user is not logged in, a guestToken is generated and returned.
   */
  createOrder: publicProcedure
    .input(
      z.object({
        imageBase64: z.string(),
        childName: z.string().min(1).max(100),
        childDescription: z.string().max(500).optional(),
        storyTheme: z.string().max(100).default("adventure"),
        mimeType: z.string().default("image/jpeg"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user?.id || null;
      const guestToken = userId ? null : nanoid(32);

      try {
        // Decode base64 and upload to S3
        const buffer = Buffer.from(input.imageBase64, "base64");
        const ns = userId ? `${userId}` : `guest-${guestToken}`;
        const fileKey = `${ns}/originals/${nanoid()}-original.${input.mimeType === "image/png" ? "png" : "jpg"}`;

        const { url: imageUrl } = await storagePut(
          fileKey,
          buffer,
          input.mimeType
        );

        // Create order record
        const result = await createOrder({
          userId,
          guestToken,
          originalImageKey: fileKey,
          originalImageUrl: imageUrl,
          amount: (PRODUCTS.PIXAR_TRANSFORMATION.priceInCents / 100).toFixed(2),
          currency: PRODUCTS.PIXAR_TRANSFORMATION.currency,
          childName: input.childName,
          childDescription: input.childDescription || null,
          storyTheme: input.storyTheme,
          status: "pending",
          paymentStatus: "unpaid",
        });

        const orderId = result.insertId;

        // Schedule preview generation and story generation
        schedulePreviewGeneration(orderId);
        scheduleStoryGeneration(orderId);

        return {
          orderId,
          imageUrl,
          guestToken, // null for logged-in users, string for guests
          message: "Order created successfully. Preview is being generated.",
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message.toLowerCase() : "";
        if (msg.includes("rate") || msg.includes("exceeded") || msg.includes("429") || msg.includes("too many")) {
          throw new Error("Our servers are busy right now. Please wait a moment and try again.");
        }
        throw error;
      }
    }),

  /**
   * Get a specific order by ID (supports guest + auth)
   */
  getOrder: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(input.orderId, ctx.user?.id, input.guestToken);
      // Refresh pre-signed URLs so they don't expire for the user
      const [originalImageUrl, generatedImageUrl, previewImageUrl, videoUrl] = await Promise.all([
        refreshUrl(order.originalImageKey, order.originalImageUrl),
        refreshUrl(order.generatedImageKey, order.generatedImageUrl),
        refreshUrl(order.previewImageKey, order.previewImageUrl),
        refreshUrl(order.videoKey, order.videoUrl),
      ]);
      return {
        ...order,
        originalImageUrl,
        generatedImageUrl,
        previewImageUrl,
        videoUrl,
        videoGenerating: isVideoGenerating(input.orderId),
        errorMessage: order.errorMessage || null,
      };
    }),

  /**
   * Get all orders for the current user (auth required)
   */
  getUserOrders: protectedProcedure.query(async ({ ctx }) => {
    return getUserOrders(ctx.user.id);
  }),

  /**
   * Update the story text for an order (supports guest + auth)
   */
  updateStory: publicProcedure
    .input(
      z.object({
        orderId: z.number(),
        guestToken: z.string().optional(),
        story: z.string().min(1).max(5000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      // Only allow story edits before approval
      if (order.storyApproved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot edit story after it has been approved. Unapprove first to make changes.",
        });
      }

      await updateOrderStory(input.orderId, input.story);

      return { success: true, story: input.story };
    }),

  /**
   * Regenerate the story for an order (supports guest + auth)
   */
  regenerateStory: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      if (order.storyApproved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot regenerate story after it has been approved",
        });
      }

      // Clear the current story and reset approval so the UI shows loading
      await updateOrderStory(input.orderId, "");
      const db = await getDb();
      if (db) {
        await db.update(orders).set({ storyApproved: false }).where(eq(orders.id, input.orderId));
      }

      // Schedule a new story generation
      scheduleStoryGeneration(input.orderId);

      return { success: true, message: "Story regeneration started" };
    }),

  /**
   * Approve the story for an order (supports guest + auth)
   */
  approveStory: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      if (!order.story || order.story.trim() === "") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot approve an empty story. Please wait for story generation or write one.",
        });
      }

      if (order.storyApproved) {
        return { success: true, message: "Story is already approved" };
      }

      const db = await getDb();
      if (db) {
        await db.update(orders).set({ storyApproved: true }).where(eq(orders.id, input.orderId));
      }

      // If already paid, trigger video generation now that story is approved
      if (order.paymentStatus === "paid" && (order.status === "completed" || order.generatedImageUrl)) {
        scheduleVideoGeneration(input.orderId);
      }

      return { success: true, message: "Story approved! You can now proceed to payment." };
    }),

  /**
   * Create a Stripe Checkout Session for an order (supports guest + auth)
   */
  createCheckoutSession: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
      promoCode: z.string().optional(),
      origin: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      if (order.paymentStatus === "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Order is already paid",
        });
      }

      if (!order.storyApproved) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please review and approve your story before proceeding to payment.",
        });
      }

      try {
        const stripe = getStripe();
        // Prefer origin passed explicitly from the frontend (window.location.origin)
        // Fall back to request headers (may be empty/wrong on proxied deployments)
        const origin = input.origin || ctx.req.headers.origin || ctx.req.headers.referer || "";
        if (!origin) {
          console.error('[Stripe] No origin available for success/cancel URLs');
        }

        const metadata: Record<string, string> = {
          order_id: input.orderId.toString(),
          child_name: order.childName || "",
        };

        if (ctx.user) {
          metadata.user_id = ctx.user.id.toString();
          metadata.customer_email = ctx.user.email || "";
          metadata.customer_name = ctx.user.name || "";
        }

        if (order.guestToken) {
          metadata.guest_token = order.guestToken;
        }

        // If a promo code is provided, look up the coupon via REST API (bypasses SDK V2 issues)
        let couponId: string | undefined;
        if (input.promoCode) {
          try {
            // Use REST API to list promotion codes and get the coupon ID
            const resp = await fetch(
              `https://api.stripe.com/v1/promotion_codes?code=${encodeURIComponent(input.promoCode)}&active=true&limit=1`,
              {
                headers: {
                  Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
                },
              }
            );
            const result = await resp.json();
            console.log('[Stripe] Promo code lookup result:', JSON.stringify(result));
            if (result.data && result.data.length > 0) {
              const pc = result.data[0];
              // In REST API response, coupon is an expanded object with .id
              couponId = pc.coupon?.id || pc.promotion?.coupon;
              console.log('[Stripe] Found coupon ID:', couponId);
            }
          } catch (e) {
            console.error('[Stripe] Error looking up promo code:', e);
          }
        }

        const sessionConfig: Parameters<typeof stripe.checkout.sessions.create>[0] = {
          mode: "payment",
          client_reference_id: ctx.user?.id?.toString() || `guest-${order.id}`,
          metadata,
          line_items: [
            {
              price_data: {
                currency: PRODUCTS.PIXAR_TRANSFORMATION.currency,
                product_data: {
                  name: PRODUCTS.PIXAR_TRANSFORMATION.name,
                  description: PRODUCTS.PIXAR_TRANSFORMATION.description,
                },
                unit_amount: PRODUCTS.PIXAR_TRANSFORMATION.priceInCents,
              },
              quantity: 1,
            },
          ],
          success_url: `${origin}/checkout?orderId=${input.orderId}&payment=success&session_id={CHECKOUT_SESSION_ID}${order.guestToken ? `&guestToken=${order.guestToken}` : ''}`,
          // {CHECKOUT_SESSION_ID} is a Stripe template variable — replaced by Stripe on redirect
          cancel_url: `${origin}/checkout?orderId=${input.orderId}&payment=cancelled${order.guestToken ? `&guestToken=${order.guestToken}` : ''}`,
        };

        // Apply discount: if coupon found from promo code, use discounts; otherwise allow manual promo codes
        if (couponId) {
          (sessionConfig as any).discounts = [{ coupon: couponId }];
        } else {
          sessionConfig.allow_promotion_codes = true;
        }

        // Prefill email if user is logged in
        if (ctx.user?.email) {
          sessionConfig.customer_email = ctx.user.email;
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        return {
          checkoutUrl: session.url,
          sessionId: session.id,
        };
      } catch (error: any) {
        console.error("[Stripe] Error creating checkout session:", error?.message || error);
        console.error("[Stripe] Error details:", JSON.stringify(error?.raw || error?.statusCode || error));
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create checkout session: ${error?.message || 'Unknown error'}`,
        });
      }
    }),

  /**
   * Get story scenes for an order (supports guest + auth)
   */
  getScenes: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await verifyOrderAccess(input.orderId, ctx.user?.id, input.guestToken);

      const db = await getDb();
      if (!db) return [];

      // Get all scenes, then deduplicate by sceneIndex (keep latest per index)
      const allScenes = await db
        .select()
        .from(storyScenes)
        .where(eq(storyScenes.orderId, input.orderId))
        .orderBy(asc(storyScenes.sceneIndex), desc(storyScenes.id));

      // Deduplicate: keep only the first (latest) scene per sceneIndex
      const seenIndices = new Set<number>();
      const scenes = allScenes.filter((s) => {
        if (seenIndices.has(s.sceneIndex)) return false;
        seenIndices.add(s.sceneIndex);
        return true;
      });

      return scenes;
    }),

  /**
   * Manually trigger video generation (supports guest + auth)
   */
  triggerVideoGeneration: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      if (order.paymentStatus !== "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment required before video generation",
        });
      }

      // Clear any previous error message when retrying
      const db = await getDb();
      if (db && order.errorMessage) {
        await db.update(orders)
          .set({ errorMessage: null })
          .where(eq(orders.id, input.orderId));
      }

      scheduleVideoGeneration(input.orderId);

      return { success: true, message: "Video generation started" };
    }),

  /**
   * Generate or retrieve a shareable link (requires auth - guests can't share)
   */
  generateShareLink: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const order = await getOrderById(input.orderId);

      if (!order || order.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found or unauthorized",
        });
      }

      if (order.paymentStatus !== "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment required before sharing",
        });
      }

      // If a share token already exists, return it
      if (order.shareToken) {
        return {
          shareToken: order.shareToken,
          shareUrl: `/share/${order.shareToken}`,
        };
      }

      // Generate a new unique share token
      const shareToken = nanoid(16);
      const db = await getDb();
      if (db) {
        await db.update(orders)
          .set({ shareToken })
          .where(eq(orders.id, input.orderId));
      }

      return {
        shareToken,
        shareUrl: `/share/${shareToken}`,
      };
    }),

  /**
   * Revoke a shareable link (requires auth)
   */
  revokeShareLink: protectedProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const order = await getOrderById(input.orderId);

      if (!order || order.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found or unauthorized",
        });
      }

      const db = await getDb();
      if (db) {
        await db.update(orders)
          .set({ shareToken: null })
          .where(eq(orders.id, input.orderId));
      }

      return { success: true, message: "Share link revoked" };
    }),

  /**
   * Public: get a shared storybook by share token (no auth required)
   */
  getSharedStorybook: publicProcedure
    .input(z.object({ shareToken: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      const result = await db.select().from(orders)
        .where(eq(orders.shareToken, input.shareToken))
        .limit(1);

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Storybook not found or link has been revoked",
        });
      }

      const order = result[0];

      // Get the scenes for this order
      const scenes = await db
        .select()
        .from(storyScenes)
        .where(eq(storyScenes.orderId, order.id))
        .orderBy(asc(storyScenes.sceneIndex));

      // Return only the data needed for the public storybook view
      return {
        childName: order.childName,
        story: order.story,
        storyTheme: order.storyTheme,
        generatedImageUrl: order.generatedImageUrl,
        hasVideo: !!order.videoUrl,
        scenes: scenes.map(s => ({
          sceneIndex: s.sceneIndex,
          sceneText: s.sceneText,
          illustrationUrl: s.illustrationUrl,
          narrationUrl: s.narrationUrl,
          status: s.status,
        })),
      };
    }),

  /**
   * Get orders by guest tokens (for guest My Orders page, no auth required)
   */
  getGuestOrders: publicProcedure
    .input(
      z.object({
        guestTokens: z.array(z.string()).max(50),
      })
    )
    .query(async ({ input }) => {
      if (input.guestTokens.length === 0) return [];
      return getOrdersByGuestTokens(input.guestTokens);
    }),

  /**
   * Claim guest orders: link guest orders to the authenticated user's account.
   * Clears the guestToken on each claimed order and sets the userId.
   */
  claimGuestOrders: protectedProcedure
    .input(
      z.object({
        guestTokens: z.array(z.string()).max(50),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.guestTokens.length === 0) {
        return { claimed: 0 };
      }

      const claimed = await claimGuestOrdersDb(ctx.user.id, input.guestTokens);
      console.log(
        `[Orders] User ${ctx.user.id} claimed ${claimed} guest orders`
      );

      return { claimed };
    }),

  /**
   * Regenerate story for a storybook (works even after approval).
   * Resets story approval, clears existing scenes, and starts fresh generation.
   */
  regenerateStorybookStory: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      if (order.paymentStatus !== "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Order must be paid before regenerating the storybook",
        });
      }

      // Reset story approval and clear existing story
      const db = await getDb();
      if (db) {
        await db.update(orders).set({
          storyApproved: false,
          story: "",
          videoUrl: null,
          videoKey: null,
          status: "processing",
        }).where(eq(orders.id, input.orderId));

        // Delete existing scenes so they get regenerated
        await db.delete(storyScenes).where(eq(storyScenes.orderId, input.orderId));
      }

      // Schedule fresh story generation
      scheduleStoryGeneration(input.orderId);

      return { success: true, message: "Storybook regeneration started. A new story and scenes will be generated." };
    }),

  /**
   * Admin: create a Stripe promo code (uses whatever Stripe key the server has)
   */
  adminCreatePromoCode: publicProcedure
    .input(
      z.object({
        code: z.string().min(3).max(50),
        percentOff: z.number().min(1).max(100).default(99),
        maxRedemptions: z.number().min(1).max(1000).default(100),
      })
    )
    .mutation(async ({ input }) => {
      const stripe = getStripe();

      // Create coupon
      const coupon = await stripe.coupons.create({
        percent_off: input.percentOff,
        duration: "once" as any,
        name: `Promo ${input.code} (${input.percentOff}% Off)`,
      });

      // Create promotion code using Stripe SDK
      const promoCode = await stripe.promotionCodes.create({
        promotion: {
          type: 'coupon',
          coupon: coupon.id,
        },
        code: input.code,
        max_redemptions: input.maxRedemptions,
      });

      return {
        code: promoCode.code,
        id: promoCode.id,
        active: promoCode.active,
        livemode: promoCode.livemode,
        percentOff: input.percentOff,
        maxRedemptions: input.maxRedemptions,
      };
    }),

  // Admin: List existing promo codes
  listPromoCodes: adminProcedure.query(async () => {
    const resp = await fetch("https://api.stripe.com/v1/promotion_codes?limit=20", {
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      },
    });
    const data = await resp.json();
    return data;
  }),

  /**
   * Admin: get all orders
   */
  adminGetAllOrders: adminProcedure.query(async () => {
    const allOrders = await getAllOrders();
    // Enrich with video generation status
    return allOrders.map(order => ({
      ...order,
      videoGenerating: isVideoGenerating(order.id),
    }));
  }),

  /**
   * Admin: retry video generation for a specific order
   */
  adminRetryVideoGeneration: adminProcedure
    .input(z.object({ orderId: z.number() }))
    .mutation(async ({ input }) => {
      const order = await getOrderById(input.orderId);
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      if (order.paymentStatus !== "paid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Order is not paid" });
      }

      // Clear any previous error message
      const db = await getDb();
      if (db && order.errorMessage) {
        await db.update(orders)
          .set({ errorMessage: null })
          .where(eq(orders.id, input.orderId));
      }

      scheduleVideoGeneration(input.orderId);

      return { success: true, message: `Video generation triggered for order ${input.orderId}` };
    }),

  /**
   * Admin: batch trigger video generation for all paid+approved orders missing videos
   */
  batchGenerateVideos: adminProcedure.mutation(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    // Find all paid, approved orders with completed scenes but no video
    const stuckOrders = await db
      .select({ id: orders.id, childName: orders.childName, storyTheme: orders.storyTheme })
      .from(orders)
      .where(
        sql`${orders.paymentStatus} = 'paid' AND ${orders.storyApproved} = 1 AND ${orders.videoUrl} IS NULL AND ${orders.generatedImageUrl} IS NOT NULL`
      )
      .orderBy(desc(orders.id));

    let triggered = 0;
    const results: { orderId: number; childName: string; status: string }[] = [];

    for (const order of stuckOrders) {
      // Check if this order has completed scenes
      const scenes = await db
        .select({ id: storyScenes.id, status: storyScenes.status })
        .from(storyScenes)
        .where(eq(storyScenes.orderId, order.id));

      const hasScenes = scenes.length > 0;
      const allCompleted = hasScenes && scenes.every(s => s.status === "completed");

      if (allCompleted) {
        // Stagger the video generation to avoid overloading
        setTimeout(() => {
          scheduleVideoGeneration(order.id);
        }, triggered * 10000); // 10 second gap between each
        triggered++;
        results.push({ orderId: order.id, childName: order.childName ?? "Unknown", status: "triggered" });
      } else if (hasScenes) {
        results.push({ orderId: order.id, childName: order.childName ?? "Unknown", status: "scenes_incomplete" });
      } else {
        results.push({ orderId: order.id, childName: order.childName ?? "Unknown", status: "no_scenes" });
      }
    }

    return {
      totalFound: stuckOrders.length,
      triggered,
      results,
    };
  }),

  /**
   * Confirm payment by querying Stripe directly — no webhook dependency.
   * Called when user lands on ?payment=success after Stripe checkout.
   */
  confirmPayment: publicProcedure
    .input(z.object({
      orderId: z.number(),
      sessionId: z.string(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify order access first
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      // If already paid, nothing to do
      if (order.paymentStatus === "paid") {
        return { confirmed: true, alreadyPaid: true };
      }

      try {
        const stripe = getStripe();
        const session = await stripe.checkout.sessions.retrieve(input.sessionId);

        if (session.payment_status === "paid" && session.metadata?.order_id === input.orderId.toString()) {
          // Update order as paid
          await updateOrderPayment(input.orderId, {
            paymentStatus: "paid",
            stripePaymentIntentId: typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || session.id,
            paidAt: new Date(),
          });

          console.log(`[ConfirmPayment] Order ${input.orderId} confirmed as paid via session ${input.sessionId}`);

          // Trigger image generation
          scheduleImageGeneration(input.orderId);

          // If story already approved and image exists, trigger video generation too
          const updatedOrder = await getOrderById(input.orderId);
          if (updatedOrder?.storyApproved && updatedOrder?.generatedImageUrl && !updatedOrder?.videoUrl) {
            scheduleVideoGeneration(input.orderId);
          }

          return { confirmed: true, alreadyPaid: false };
        }

        // Payment not confirmed by Stripe
        return { confirmed: false, alreadyPaid: false };
      } catch (error: any) {
        console.error(`[ConfirmPayment] Error retrieving session ${input.sessionId}:`, error?.message);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to verify payment with Stripe",
        });
      }
    }),

  /**
   * Backfill orders that have a videoUrl but are stuck at processing/pending status.
   * Safe to run multiple times (idempotent).
   */
  /**
   * Backfill Content-Disposition: attachment on all existing S3 video objects.
   * Uses copy-in-place so no bytes are re-uploaded.
   */
  backfillVideoContentDisposition: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const videoOrders = await db
        .select({ id: orders.id, videoKey: orders.videoKey })
        .from(orders)
        .where(isNotNull(orders.videoKey));
      let updated = 0;
      const errors: string[] = [];
      for (const o of videoOrders) {
        if (!o.videoKey) continue;
        try {
          await storageUpdateMetadata(o.videoKey, {
            contentDisposition: 'attachment; filename="storybook.mp4"',
            contentType: "video/mp4",
          });
          updated++;
        } catch (err: any) {
          errors.push(`Order ${o.id}: ${err?.message}`);
        }
      }
      return {
        updated,
        errors,
        message: `Updated Content-Disposition on ${updated}/${videoOrders.length} video objects`,
      };
    }),

  backfillCompletedOrders: adminProcedure
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const stuckOrders = await db
        .select({ id: orders.id, status: orders.status })
        .from(orders)
        .where(
          and(
            isNotNull(orders.videoUrl),
            not(eq(orders.status, "completed"))
          )
        );

      if (stuckOrders.length === 0) {
        return { updated: 0, message: "No stuck orders found" };
      }

      for (const o of stuckOrders) {
        await db.update(orders)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(orders.id, o.id));
      }

      return {
        updated: stuckOrders.length,
        message: `Backfilled ${stuckOrders.length} orders to completed status`,
        orderIds: stuckOrders.map(o => o.id),
      };
    }),
});


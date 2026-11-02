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
import { storagePut, storageGet, storagePublicUrl, storageGetSignedUrl } from "../storage";
import { privateMediaUrl, privateDownloadUrl } from "../services/privateMediaDelivery";
import { getPaymentScope, isStripeContextValid } from "../services/paymentContext";
import { scheduleImageGeneration } from "../jobs/imageGenerationJob";
import { nanoid } from "nanoid";
import { PRODUCTS } from "../stripe-products";
import { schedulePreviewGeneration, isPreviewGenerating } from "../jobs/previewGenerationJob";
import { scheduleStoryGeneration } from "../jobs/storyGenerationJob";
import { scheduleVideoGeneration, isVideoGenerating } from "../jobs/videoGenerationJob";
import { scheduleNarrationRecovery, isNarrationRecovering, getNarrationRecoveryState } from "../jobs/narrationRecoveryJob";
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

function narrationRetryPending(order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>): boolean {
  return isNarrationRecovering(order.id) || getNarrationRecoveryState(order).pending;
}

function assertNarrationRetryIdle(order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>) {
  if (narrationRetryPending(order)) {
    throw new TRPCError({ code: "CONFLICT", message: "Your recorded-voice narration is being updated. Please wait before starting another retry." });
  }
}

const narrationRetryTimes = new Map<number, number>();

async function signSceneMedia<T extends { illustrationKey?: string | null; illustrationUrl?: string | null; narrationKey?: string | null; narrationUrl?: string | null }>(scene: T) {
  return {
    ...scene,
    illustrationUrl: await privateMediaUrl(scene.illustrationKey, scene.illustrationUrl),
    narrationUrl: await privateMediaUrl(scene.narrationKey, scene.narrationUrl),
  };
}

async function signOrderListMedia<T extends { originalImageKey?: string | null; originalImageUrl?: string | null; previewImageKey?: string | null; previewImageUrl?: string | null; generatedImageKey?: string | null; generatedImageUrl?: string | null; videoKey?: string | null; videoUrl?: string | null }>(order: T) {
  return {
    ...order,
    originalImageUrl: await privateMediaUrl(order.originalImageKey, order.originalImageUrl),
    previewImageUrl: await privateMediaUrl(order.previewImageKey, order.previewImageUrl),
    generatedImageUrl: await privateMediaUrl(order.generatedImageKey, order.generatedImageUrl),
    videoUrl: await privateMediaUrl(order.videoKey, order.videoUrl),
  };
}

// Manual preview retries only; bounded memory and no automatic generation on polling.
const previewRetryTimes = new Map<number, number>();

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

      // Auto-resume: if order is paid + story approved + no video + job not running, restart video gen.
      // This handles the case where the server process was restarted (cloud run idle shutdown)
      // and killed the in-progress video generation job.
      if (
        order.paymentStatus === "paid" &&
        order.storyApproved &&
        !(order.videoKey || order.videoUrl) &&
        !order.errorMessage &&
        !isVideoGenerating(input.orderId)
      ) {
        // Check scene state to decide what to resume
        const db = await getDb();
        if (db) {
          const sceneRows = await db
            .select({ id: storyScenes.id, status: storyScenes.status })
            .from(storyScenes)
            .where(eq(storyScenes.orderId, input.orderId));

          if (sceneRows.length > 0) {
            const allDone = sceneRows.every((s) => s.status === "completed");
            if (allDone) {
              // All scenes done but no video — resume video composition
              console.log(`[getOrder] Auto-resuming stuck video composition for order ${input.orderId}`);
              scheduleVideoGeneration(input.orderId);
            } else {
              // Some scenes are stuck (server was restarted mid-scene) — resume full video job
              const stuckScenes = sceneRows.filter((s) => s.status !== "completed");
              console.log(`[getOrder] Auto-resuming stuck scene generation for order ${input.orderId} (${stuckScenes.length} scenes stuck)`);
              scheduleVideoGeneration(input.orderId);
            }
          } else if (order.generatedImageKey || order.generatedImageUrl) {
            // No scenes yet but image is ready — resume video generation from scratch
            console.log(`[getOrder] Auto-resuming video generation (no scenes yet) for order ${input.orderId}`);
            scheduleVideoGeneration(input.orderId);
          }
        }
      }

      // Viewing must never erase/recreate paid assets on an S3 access error.
      // Order ownership/guest access was verified above. Never sign arbitrary client keys.
      // Link failures should not hide the successfully generated story or the whole order.
      let originalImageAccessError: string | null = null;
      let previewImageAccessError: string | null = null;
      const signImage = async (key: string | null | undefined, kind: "original" | "preview") => {
        if (!key) return null;
        try {
          return (await storageGetSignedUrl(key)).url;
        } catch {
          const message = "This image is temporarily unavailable. Please refresh to try again.";
          if (kind === "original") originalImageAccessError = message;
          else previewImageAccessError = message;
          return null;
        }
      };
      const originalImageUrl = await signImage(order.originalImageKey, "original");
      const generatedImageUrl = await privateMediaUrl(order.generatedImageKey, order.generatedImageUrl);
      const previewImageUrl = await signImage(order.previewImageKey, "preview");
      const videoUrl = await privateMediaUrl(order.videoKey, order.videoUrl);
      const voiceSampleUrl = await privateMediaUrl(order.voiceSampleKey, order.voiceSampleUrl);
      const previewError = order.errorMessage?.startsWith("Preview: ")
        ? order.errorMessage.slice("Preview: ".length)
        : null;
      const narrationRecovery = getNarrationRecoveryState(order);
      const narrationPending = narrationRetryPending(order);
      return {
        ...order,
        originalImageUrl,
        generatedImageUrl,
        previewImageUrl,
        videoUrl,
        voiceSampleUrl,
        generatedImageAccessError: order.generatedImageKey && !generatedImageUrl ? "This image is temporarily unavailable. Please refresh to try again." : null,
        videoAccessError: order.videoKey && !videoUrl ? "This video is temporarily unavailable. Please refresh to try again." : null,
        originalImageAccessError,
        previewImageAccessError,
        previewError,
        previewGenerating: isPreviewGenerating(input.orderId),
        videoGenerating: isVideoGenerating(input.orderId),
        narrationRetryPending: narrationPending,
        narrationRetryError: narrationRecovery.error,
        errorMessage: narrationPending
          ? "Voice: Updating recorded narration. Your existing video remains available."
          : order.errorMessage?.startsWith("NarrationRecovery: lease:")
            ? narrationRecovery.error || "The narration update was interrupted. Your existing video is unchanged."
            : order.errorMessage || null,
      };
    }),

  /** Explicit recovery for an existing unpaid preview; never accepts an S3 key. */
  retryPreview: publicProcedure
    .input(z.object({ orderId: z.number().int().positive(), guestToken: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(input.orderId, ctx.user?.id, input.guestToken);
      if (order.paymentStatus !== "unpaid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Preview retry is only available before payment." });
      }
      if (order.previewImageKey || isPreviewGenerating(input.orderId)) {
        return { scheduled: false, message: "The preview is ready or already being generated." };
      }
      const now = Date.now();
      const previous = previewRetryTimes.get(input.orderId);
      if (previous !== undefined && now - previous < 60_000) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait one minute before retrying this preview." });
      }
      previewRetryTimes.delete(input.orderId);
      if (previewRetryTimes.size >= 500) {
        const oldest = previewRetryTimes.keys().next().value;
        if (oldest !== undefined) previewRetryTimes.delete(oldest);
      }
      previewRetryTimes.set(input.orderId, now);
      await schedulePreviewGeneration(input.orderId);
      return { scheduled: true, message: "Preview generation has been queued." };
    }),

  /**
   * Get all orders for the current user (auth required)
   */
  getUserOrders: protectedProcedure.query(async ({ ctx }) => {
    return Promise.all((await getUserOrders(ctx.user.id)).map(signOrderListMedia));
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
        app_scope: getPaymentScope(),
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
          payment_intent_data: { metadata },
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

      return Promise.all(scenes.map(signSceneMedia));
    }),

  /** Recorded-voice recovery only: owner/guest must explicitly confirm credit usage. */
  retryOwnNarration: publicProcedure
    .input(z.object({ orderId: z.number().int().positive(), guestToken: z.string().optional(), confirm: z.literal(true) }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(input.orderId, ctx.user?.id, input.guestToken);
      if (order.paymentStatus !== "paid" || !order.storyApproved) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A paid, approved story is required before retrying narration." });
      }
      if (!(order.voiceSampleKey || order.voiceSampleUrl)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This order has no saved voice recording." });
      }
      if (!order.videoKey) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Please wait for the current MP4 to finish before retrying its narration." });
      }
      if (order.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Please wait for the current storybook to complete before retrying its narration." });
      }
      assertNarrationRetryIdle(order);
      if (isVideoGenerating(input.orderId)) {
        throw new TRPCError({ code: "CONFLICT", message: "Video work is already running. Please wait." });
      }
      const now = Date.now();
      const last = narrationRetryTimes.get(input.orderId);
      if (last !== undefined && now - last < 60_000) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Please wait one minute before retrying narration again." });
      }
      if (!scheduleNarrationRecovery(input.orderId)) {
        throw new TRPCError({ code: "CONFLICT", message: "Narration is already being updated." });
      }
      narrationRetryTimes.forEach((time, id) => { if (now - time >= 60_000) narrationRetryTimes.delete(id); });
      if (narrationRetryTimes.size >= 200) narrationRetryTimes.delete(Array.from(narrationRetryTimes.keys())[0]);
      narrationRetryTimes.set(input.orderId, now);
      return { success: true, message: "Recorded-voice narration retry queued. Existing images and story will be kept." };
    }),

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

      assertNarrationRetryIdle(order);
      if (order.paymentStatus !== "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment required before video generation",
        });
      }

      if (!order.storyApproved) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Please approve the story before video generation." });
      }
      if (!(order.generatedImageKey || order.generatedImageUrl)) {
        await scheduleImageGeneration(input.orderId);
        return { success: true, message: "Character generation has been queued." };
      }

      // Clear any previous error message when retrying
      const db = await getDb();
      if (db && order.errorMessage) {
        await db.update(orders)
          .set({ errorMessage: null })
          .where(eq(orders.id, input.orderId));
      }

      scheduleVideoGeneration(input.orderId, { retryMissingScenes: true });

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
      if (order.paymentStatus !== "paid") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Storybook not found or link has been revoked" });
      }

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
        generatedImageUrl: await privateMediaUrl(order.generatedImageKey, order.generatedImageUrl),
        hasVideo: !!(order.videoKey || order.videoUrl),
        videoKey: order.videoKey || null, // needed for download URL generation
        scenes: await Promise.all(scenes.map(async s => ({
          sceneIndex: s.sceneIndex,
          sceneText: s.sceneText,
          illustrationUrl: await privateMediaUrl(s.illustrationKey, s.illustrationUrl),
          narrationUrl: await privateMediaUrl(s.narrationKey, s.narrationUrl),
          status: s.status,
        }))),
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
      return Promise.all((await getOrdersByGuestTokens(input.guestTokens)).map(signOrderListMedia));
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

      assertNarrationRetryIdle(order);
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
    // Derive videoGenerating from DB status — do NOT use in-memory isVideoGenerating()
    // because Cloud Run routes requests to different instances with empty in-memory Sets.
    return Promise.all(allOrders.map(async order => ({
      ...await signOrderListMedia(order),
      videoGenerating:
        order.paymentStatus === "paid" &&
        order.status === "processing" &&
        !order.videoUrl &&
        !order.videoKey,
    })));
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
   * Backfill orders that have a videoUrl but are stuck at processing/pending status.
   * Safe to run multiple times (idempotent).
   */
  /**
   * Verify a Stripe checkout session and mark the order as paid if confirmed.
   * This is a client-side fallback for when the webhook is delayed or fails.
   * Called immediately when the user returns from Stripe with ?payment=success&session_id=...
   */
  verifyStripeSession: publicProcedure
    .input(z.object({
      orderId: z.number(),
      sessionId: z.string(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify order access
      const order = await verifyOrderAccess(
        input.orderId,
        ctx.user?.id,
        input.guestToken
      );

      if (order.paymentStatus === "refunded") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This order has been refunded." });
      }

      // If already paid, nothing to do
      if (order.paymentStatus === "paid") {
        return { success: true, alreadyPaid: true };
      }

      // Retrieve the Stripe session to confirm payment
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(input.sessionId);

      if (session.payment_status !== "paid") {
        return { success: false, alreadyPaid: false, status: session.payment_status };
      }

      if (!isStripeContextValid(session.livemode, session.metadata)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Payment session belongs to a different environment." });
      }

      // Verify the session belongs to this order
      const sessionOrderId = parseInt(session.metadata?.order_id || "0");
      if (sessionOrderId !== input.orderId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Session does not match order" });
      }

      // Mark order as paid and trigger generation
      await updateOrderPayment(input.orderId, {
        paymentStatus: "paid",
        stripePaymentIntentId: typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent as any)?.id || session.id,
        paidAt: new Date(),
      });

      console.log(`[VerifySession] Marked order ${input.orderId} as paid via session verification`);

      // The guarded worker prevents webhook/browser-return races from regenerating assets.
      await scheduleImageGeneration(input.orderId);

      return { success: true, alreadyPaid: false };
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

  /**
   * Get a short-lived pre-signed S3 download URL for a shared storybook video.
   * Anyone with the share token can download the video.
   */
  getSharedStorybookDownloadUrl: publicProcedure
    .input(z.object({ shareToken: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const result = await db.select().from(orders)
        .where(eq(orders.shareToken, input.shareToken))
        .limit(1);

      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Storybook not found" });
      }

      const order = result[0];
      if (!order.videoKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not ready yet" });
      }

      if (order.paymentStatus !== "paid") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Storybook not found" });
      }
      const childName = (order.childName || "storybook").replace(/[^a-z0-9]/gi, "-").toLowerCase();
      return privateDownloadUrl(order.videoKey, `${childName}-animated-story.mp4`, "video/mp4");
    }),

  /**
   * Get a short-lived pre-signed S3 download URL for a completed storybook video.
   * Returns the URL directly so the frontend can use window.open() to trigger
   * a download — avoids the cross-origin <a download> limitation and ensures
   * the session cookie is always sent (via tRPC, not a bare link).
   */
  getVideoDownloadUrl: publicProcedure
    .input(z.object({
      orderId: z.number(),
      guestToken: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(input.orderId, ctx.user?.id, input.guestToken);

      if (!order.videoKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not ready yet" });
      }

      const childName = (order.childName || "storybook").replace(/[^a-z0-9]/gi, "-").toLowerCase();
      return privateDownloadUrl(order.videoKey, `${childName}-animated-story.mp4`, "video/mp4");
    }),
  getCharacterDownloadUrl: publicProcedure
    .input(z.object({ orderId: z.number().int().positive(), guestToken: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await verifyOrderAccess(input.orderId, ctx.user?.id, input.guestToken);
      if (!order.generatedImageKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Character image not ready yet" });
      }
      const childName = (order.childName || "character").replace(/[^a-z0-9]/gi, "-").toLowerCase();
      return privateDownloadUrl(order.generatedImageKey, `${childName}-animated-character.png`, "image/png");
    }),
});

import { Request, Response } from "express";
import Stripe from "stripe";
import { getOrderById, updateOrderPayment } from "../db";
import { scheduleImageGeneration } from "../jobs/imageGenerationJob";
import { isStripeContextValid } from "../services/paymentContext";

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

function metadataFor(object: { metadata?: Stripe.Metadata | null }): Record<string, string> | null {
  return object.metadata ? { ...object.metadata } : null;
}

function positiveOrderId(metadata: Record<string, string> | null): number | null {
  const rawOrderId = metadata?.order_id;
  if (!rawOrderId || !/^[1-9]\d*$/.test(rawOrderId)) return null;

  const orderId = Number(rawOrderId);
  return Number.isSafeInteger(orderId) ? orderId : null;
}

async function markPaidAndScheduleImage(
  orderId: number,
  stripePaymentIntentId: string
): Promise<void> {
  // Read before writing so a duplicate event does not change paidAt or replace a
  // payment identifier. It also keeps refunded orders from being revived.
  const order = await getOrderById(orderId);
  if (!order) {
    console.warn(`[Webhook] Order ${orderId} was not found; ignoring payment event`);
    return;
  }

  if (order.paymentStatus === "refunded") {
    console.warn(`[Webhook] Order ${orderId} is refunded; ignoring paid callback`);
    return;
  }

  if (order.paymentStatus !== "paid") {
    await updateOrderPayment(orderId, {
      paymentStatus: "paid",
      stripePaymentIntentId,
      paidAt: new Date(),
    });
    console.log(`[Webhook] Marked order ${orderId} as paid`);
  } else {
    console.log(`[Webhook] Order ${orderId} was already paid; retaining original payment fields`);
  }

  // The worker has queued/active guards and a durable database claim. Scheduling
  // every valid paid delivery safely recovers an interrupted job without issuing
  // duplicate model, scene, or video work.
  await scheduleImageGeneration(orderId);
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"] as string;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error("[Webhook] Stripe is not configured:", error);
    return res.status(500).json({ received: false, error: "Stripe webhook configuration failed" });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown signature verification error";
    console.error("[Webhook] Signature verification failed:", message);
    return res.status(400).json({ verified: false, error: "Webhook signature verification failed" });
  }

  // Stripe's signature-verified test handshake contains no customer action and
  // intentionally remains compatible with the existing deployment check.
  if (event.id.startsWith("evt_test_")) {
    console.log("[Webhook] Test event detected, returning verification response");
    return res.status(200).json({ verified: true });
  }

  const metadata = metadataFor(
    event.data.object as { metadata?: Stripe.Metadata | null }
  );
  if (!isStripeContextValid(event.livemode, metadata)) {
    console.warn(`[Webhook] Ignoring ${event.type} from another Stripe mode or app scope`);
    return res.status(200).json({ received: true, verified: true, ignored: "stripe_context" });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = positiveOrderId(metadataFor(session));

        if (!orderId || session.payment_status !== "paid") {
          console.warn("[Webhook] Ignoring checkout completion without a positive paid order_id");
          break;
        }

        const stripePaymentIntentId =
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || session.id;
        await markPaidAndScheduleImage(orderId, stripePaymentIntentId);
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = positiveOrderId(metadataFor(paymentIntent));

        if (!orderId || paymentIntent.status !== "succeeded") {
          console.warn("[Webhook] Ignoring payment intent success without a positive succeeded order_id");
          break;
        }

        await markPaidAndScheduleImage(orderId, paymentIntent.id);
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = positiveOrderId(metadataFor(paymentIntent));
        if (orderId) {
          console.log(`[Webhook] Payment failed for order ${orderId}`);
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const paymentIntentId = charge.payment_intent;
        if (paymentIntentId) {
          console.log(`[Webhook] Charge refunded for payment intent ${paymentIntentId}`);
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return res.status(200).json({ received: true, verified: true });
  } catch (error) {
    console.error("[Webhook] Error processing event:", error);
    return res.status(500).json({ received: false, verified: true, processingError: true });
  }
}

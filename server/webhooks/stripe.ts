import { Request, Response } from "express";
import Stripe from "stripe";
import { updateOrderPayment } from "../db";
import { scheduleImageGeneration } from "../jobs/imageGenerationJob";

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";

export async function handleStripeWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error: any) {
    console.error("[Webhook] Signature verification failed:", error.message);
    // Always return 200 with valid JSON, even on verification failure
    return res.status(200).json({ verified: false, error: "Webhook signature verification failed" });
  }

  // Handle test events — must return { verified: true } for webhook verification
  if (event.id.startsWith("evt_test_")) {
    console.log("[Webhook] Test event detected, returning verification response");
    return res.status(200).json({
      verified: true,
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = parseInt(session.metadata?.order_id || "0");

        if (orderId && session.payment_status === "paid") {
          await updateOrderPayment(orderId, {
            paymentStatus: "paid",
            stripePaymentIntentId: typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || session.id,
            paidAt: new Date(),
          });

          console.log(`[Webhook] Checkout session completed for order ${orderId}`);

          // Trigger image generation after successful payment
          scheduleImageGeneration(orderId);
        }
        break;
      }

      case "payment_intent.succeeded": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = parseInt(paymentIntent.metadata?.order_id || "0");

        if (orderId) {
          // Check if already marked as paid (from checkout.session.completed)
          // This is a fallback handler
          await updateOrderPayment(orderId, {
            paymentStatus: "paid",
            stripePaymentIntentId: paymentIntent.id,
            paidAt: new Date(),
          });

          console.log(`[Webhook] Payment intent succeeded for order ${orderId}`);

          // Trigger image generation (idempotent - won't re-run if already started)
          scheduleImageGeneration(orderId);
        }
        break;
      }

      case "payment_intent.payment_failed": {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const orderId = parseInt(paymentIntent.metadata?.order_id || "0");

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

    // Always return 200 with valid JSON
    return res.status(200).json({ received: true, verified: true });
  } catch (error) {
    console.error("[Webhook] Error processing event:", error);
    // Always return 200 with valid JSON, even on processing errors
    return res.status(200).json({ received: true, verified: true, processingError: true });
  }
}

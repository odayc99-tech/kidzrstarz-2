import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  getOrderById: vi.fn(),
  updateOrderPayment: vi.fn(),
  scheduleImageGeneration: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    webhooks = { constructEvent: mocks.constructEvent };
  },
}));
vi.mock("../db", () => ({
  getOrderById: mocks.getOrderById,
  updateOrderPayment: mocks.updateOrderPayment,
}));
vi.mock("../jobs/imageGenerationJob", () => ({
  scheduleImageGeneration: mocks.scheduleImageGeneration,
}));

import { getPaymentScope } from "../services/paymentContext";
import { handleStripeWebhook } from "./stripe";

const environmentNames = [
  "STRIPE_SECRET_KEY",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
  "VITE_APP_ID",
] as const;
const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

function responseMock() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

function requestMock() {
  return {
    headers: { "stripe-signature": "test-signature" },
    body: Buffer.from("signed-test-body"),
  } as any;
}

function paidOrder(overrides: Record<string, unknown> = {}) {
  return { id: 22, paymentStatus: "unpaid", ...overrides };
}

function checkoutEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        id: "cs_123",
        payment_status: "paid",
        payment_intent: "pi_123",
        metadata: { order_id: "22", app_scope: getPaymentScope() },
      },
    },
    ...overrides,
  } as any;
}

describe("Stripe webhook paid callback repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of environmentNames) delete process.env[name];
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.VITE_APP_ID = "kidzrstarz-test";
    mocks.getOrderById.mockResolvedValue(paidOrder());
    mocks.updateOrderPayment.mockResolvedValue(undefined);
    mocks.scheduleImageGeneration.mockResolvedValue(undefined);
  });

  afterAll(() => {
    for (const name of environmentNames) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("returns 400 on invalid raw signature and performs no database write", async () => {
    mocks.constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(mocks.getOrderById).not.toHaveBeenCalled();
    expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    expect(mocks.scheduleImageGeneration).not.toHaveBeenCalled();
  });

  it("ignores a signature-verified event from the wrong Stripe mode before database access", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent({ livemode: true }));
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mocks.getOrderById).not.toHaveBeenCalled();
    expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    expect(mocks.scheduleImageGeneration).not.toHaveBeenCalled();
  });

  it("ignores a signature-verified event with a mismatched app scope before database access", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent({
      data: { object: {
        id: "cs_123",
        payment_status: "paid",
        payment_intent: "pi_123",
        metadata: { order_id: "22", app_scope: "local:another-app" },
      } },
    }));
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(mocks.getOrderById).not.toHaveBeenCalled();
    expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
  });

  it("fetches the order, marks a newly paid checkout once, and schedules the protected image worker", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent());
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(mocks.getOrderById).toHaveBeenCalledWith(22);
    expect(mocks.updateOrderPayment).toHaveBeenCalledWith(22, expect.objectContaining({
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_123",
      paidAt: expect.any(Date),
    }));
    expect(mocks.scheduleImageGeneration).toHaveBeenCalledWith(22);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("does not reset paidAt or payment identifier for a duplicate paid callback, while safely reusing the protected scheduler", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent());
    mocks.getOrderById.mockResolvedValue(paidOrder({
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_original",
      paidAt: new Date("2026-11-01T17:00:00Z"),
    }));
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    expect(mocks.scheduleImageGeneration).toHaveBeenCalledWith(22);
  });

  it("rejects unpaid checkout completion and malformed order IDs without updates or generation", async () => {
    const response = responseMock();
    mocks.constructEvent.mockReturnValue(checkoutEvent({
      data: { object: {
        id: "cs_123",
        payment_status: "unpaid",
        payment_intent: "pi_123",
        metadata: { order_id: "0", app_scope: getPaymentScope() },
      } },
    }));

    await handleStripeWebhook(requestMock(), response as any);

    expect(mocks.getOrderById).not.toHaveBeenCalled();
    expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    expect(mocks.scheduleImageGeneration).not.toHaveBeenCalled();
  });

  it("does not revive a refunded order from a later paid callback", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent());
    mocks.getOrderById.mockResolvedValue(paidOrder({ paymentStatus: "refunded" }));
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(mocks.updateOrderPayment).not.toHaveBeenCalled();
    expect(mocks.scheduleImageGeneration).not.toHaveBeenCalled();
  });

  it("returns 500 when a verified event cannot be processed", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent());
    mocks.getOrderById.mockRejectedValue(new Error("offline database mock failure"));
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(mocks.scheduleImageGeneration).not.toHaveBeenCalled();
  });

  it("retains the existing signature-verified evt_test handshake without writes", async () => {
    mocks.constructEvent.mockReturnValue(checkoutEvent({ id: "evt_test_handshake" }));
    const response = responseMock();

    await handleStripeWebhook(requestMock(), response as any);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ verified: true });
    expect(mocks.getOrderById).not.toHaveBeenCalled();
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { getPaymentScope, isStripeContextValid } from "./paymentContext";

const scopedEnvironment = [
  "STRIPE_SECRET_KEY",
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
  "VITE_APP_ID",
] as const;
const originalEnvironment = Object.fromEntries(
  scopedEnvironment.map((name) => [name, process.env[name]])
);

function resetEnvironment() {
  for (const name of scopedEnvironment) delete process.env[name];
}

describe("paymentContext paid callback isolation", () => {
  beforeEach(() => {
    resetEnvironment();
  });

  afterAll(() => {
    for (const name of scopedEnvironment) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("uses stable non-secret Railway project, environment, and service identifiers when available", () => {
    process.env.RAILWAY_PROJECT_ID = "project-123";
    process.env.RAILWAY_ENVIRONMENT_ID = "environment-456";
    process.env.RAILWAY_SERVICE_ID = "service-789";

    expect(getPaymentScope()).toBe("railway:project-123:environment-456:service-789");
  });

  it("falls back to a stable local application identity", () => {
    process.env.VITE_APP_ID = "kidzrstarz-staging";

    expect(getPaymentScope()).toBe("local:kidzrstarz-staging");
  });

  it("requires a recognizable secret-key mode and matching Stripe livemode", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    expect(isStripeContextValid(false)).toBe(true);
    expect(isStripeContextValid(true)).toBe(false);

    process.env.STRIPE_SECRET_KEY = "rk_live_mock";
    expect(isStripeContextValid(true)).toBe(true);
    expect(isStripeContextValid(false)).toBe(false);

    process.env.STRIPE_SECRET_KEY = "not-a-stripe-key";
    expect(isStripeContextValid(false)).toBe(false);
  });

  it("requires a present app_scope to match while accepting missing legacy scope", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_mock";
    process.env.VITE_APP_ID = "kidzrstarz-staging";

    expect(isStripeContextValid(false)).toBe(true);
    expect(isStripeContextValid(false, { order_id: "22" })).toBe(true);
    expect(isStripeContextValid(false, {
      app_scope: "local:kidzrstarz-staging",
      order_id: "22",
    })).toBe(true);
    expect(isStripeContextValid(false, {
      app_scope: "railway:other:environment:service",
      order_id: "22",
    })).toBe(false);
    expect(isStripeContextValid(false, { app_scope: "" })).toBe(false);
  });
});

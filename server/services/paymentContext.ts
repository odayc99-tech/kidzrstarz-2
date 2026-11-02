const RAILWAY_SCOPE_ENVIRONMENT_KEYS = [
  "RAILWAY_PROJECT_ID",
  "RAILWAY_ENVIRONMENT_ID",
  "RAILWAY_SERVICE_ID",
] as const;

function valueOfEnvironment(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

/**
 * Return a stable, non-secret identity for the currently running application.
 * Railway IDs isolate checkout metadata between projects, environments, and
 * services. Local and other non-Railway deployments use the application ID.
 */
export function getPaymentScope(): string {
  const railwayIds = RAILWAY_SCOPE_ENVIRONMENT_KEYS.map(valueOfEnvironment);
  if (railwayIds.every((value): value is string => value !== null)) {
    return `railway:${railwayIds.join(":")}`;
  }

  const localAppId = valueOfEnvironment("VITE_APP_ID") || "kidzrstarz";
  return `local:${localAppId}`;
}

function expectedStripeLiveMode(): boolean | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim() || "";
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return true;
  }
  if (secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_")) {
    return false;
  }
  return null;
}

/**
 * Validate a Stripe event/session against this process's credential mode and,
 * when supplied, the checkout metadata scope. Missing app_scope is accepted for
 * legacy Stripe objects; the webhook endpoint and signing secret remain the
 * boundary for those objects.
 */
export function isStripeContextValid(
  livemode: boolean,
  metadata?: Record<string, string> | null
): boolean {
  const expectedLiveMode = expectedStripeLiveMode();
  if (expectedLiveMode === null || livemode !== expectedLiveMode) {
    return false;
  }

  if (metadata && Object.prototype.hasOwnProperty.call(metadata, "app_scope")) {
    return metadata.app_scope === getPaymentScope();
  }

  return true;
}

/**
 * Retry utility with exponential backoff for API calls.
 * Handles rate limiting (429) and transient server errors (5xx).
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms before first retry (default: 2000) */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelayMs?: number;
  /** Label for logging (default: "API call") */
  label?: string;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 2000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
  label: "API call",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("rate") ||
      msg.includes("429") ||
      msg.includes("exceeded") ||
      msg.includes("too many") ||
      msg.includes("503") ||
      msg.includes("502") ||
      msg.includes("504") ||
      msg.includes("timeout") ||
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("fetch failed")
    );
  }
  return false;
}

/**
 * Execute a function with retry logic and exponential backoff.
 * Retries on rate limit errors and transient failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelayMs
      );

      console.warn(
        `[Retry] ${opts.label} failed (attempt ${attempt + 1}/${opts.maxRetries + 1}), ` +
          `retrying in ${delay}ms: ${error instanceof Error ? error.message : String(error)}`
      );

      await sleep(delay);
    }
  }

  throw lastError;
}

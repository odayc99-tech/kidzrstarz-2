/**
 * Centralised environment variable access.
 *
 * Standard vars work on any host (Railway, Manus, etc.).
 * Forge vars are used on Manus hosting for image generation;
 * on Railway, leave them unset and use OPENAI_API_KEY instead.
 */
export const ENV = {
  /** MySQL connection string, e.g. mysql://user:pass@host:3306/dbname */
  databaseUrl: process.env.DATABASE_URL ?? "",

  /** Secret used to sign/verify session JWTs */
  cookieSecret: process.env.JWT_SECRET ?? "",

  /** Secret header value required to access admin procedures */
  adminSecret: process.env.ADMIN_SECRET ?? "",

  /** OpenAI-compatible API key for LLM + image generation (Railway / direct OpenAI) */
  openAiApiKey: process.env.OPENAI_API_KEY ?? "",

  /** OpenAI-compatible base URL (defaults to api.openai.com) */
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",

  /**
   * Manus Forge API base URL — used for image generation on Manus hosting.
   * When set, imageGeneration.ts uses the Forge ImageService instead of OpenAI.
   * On Railway, leave unset and provide OPENAI_API_KEY instead.
   */
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",

  /** Manus Forge API key — server-side only */
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  /** Resend API key for owner email notifications */
  resendApiKey: process.env.RESEND_API_KEY ?? "",

  /** Email address to send owner notifications to */
  ownerEmail: process.env.OWNER_EMAIL ?? "",

  isProduction: process.env.NODE_ENV === "production",
};

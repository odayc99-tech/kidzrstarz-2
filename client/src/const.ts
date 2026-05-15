export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Clerk publishable key — not a secret, safe to hardcode as fallback.
// VITE_ env vars are only available if set at Vite build time; this fallback
// ensures the sign-in modal always works regardless of build environment.
export const CLERK_PUBLISHABLE_KEY =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  "pk_test_bXV0dWFsLWRvcnktMzcuY2xlcmsuYWNjb3VudHMuZGV2JA";

// Kept for any legacy references — Clerk modal is now used instead.
export const getLoginUrl = () => "#";

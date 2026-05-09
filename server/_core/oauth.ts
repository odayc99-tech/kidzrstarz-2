import type { Express } from "express";

/**
 * OAuth routes stub.
 *
 * KidzRstarz does not require user login — customers use guest tokens.
 * Admin access is controlled by the ADMIN_SECRET env var.
 * This file is kept as a no-op so imports in index.ts compile without changes.
 */
export function registerOAuthRoutes(_app: Express) {
  // No OAuth routes needed.
}

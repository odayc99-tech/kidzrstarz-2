import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { createClerkClient } from "@clerk/backend";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { ENV } from "./env";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

// Lazy-initialise Clerk client
let _clerkClient: ReturnType<typeof createClerkClient> | null = null;
function getClerkClient() {
  if (!_clerkClient) {
    if (!ENV.clerkSecretKey) {
      throw new Error("CLERK_SECRET_KEY environment variable is not set");
    }
    _clerkClient = createClerkClient({ secretKey: ENV.clerkSecretKey });
  }
  return _clerkClient;
}

export function registerOAuthRoutes(app: Express) {
  /**
   * POST /api/auth/clerk-session
   * Called from the frontend after Clerk signs the user in.
   * The frontend sends the Clerk session token; we verify it, upsert the user
   * in our DB, then set our own JWT session cookie so the rest of the app
   * (tRPC, guest order claiming, etc.) works unchanged.
   */
  app.post("/api/auth/clerk-session", async (req: Request, res: Response) => {
    const token = req.body?.token as string | undefined;

    if (!token) {
      res.status(400).json({ error: "Missing token" });
      return;
    }

    try {
      const clerk = getClerkClient();

      // Verify the Clerk session token and get the Clerk user ID
      const { verifyToken } = await import("@clerk/backend");
      const payload = await verifyToken(token, {
        secretKey: ENV.clerkSecretKey,
      });
      const clerkUserId = payload.sub;

      // Fetch full user profile from Clerk
      const clerkUser = await clerk.users.getUser(clerkUserId);
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;
      const name = [clerkUser.firstName, clerkUser.lastName]
        .filter(Boolean)
        .join(" ") || clerkUser.username || email || "User";
      const loginMethod =
        clerkUser.externalAccounts[0]?.provider ?? "clerk";

      // Upsert into our users table (openId = Clerk user ID)
      await db.upsertUser({
        openId: clerkUserId,
        name,
        email,
        loginMethod,
        lastSignedIn: new Date(),
      });

      // Create our own JWT session cookie — same mechanism as before
      const sessionToken = await sdk.createSessionToken(clerkUserId, {
        name,
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, {
        ...cookieOptions,
        maxAge: ONE_YEAR_MS,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("[Clerk] Session exchange failed", error);
      res.status(401).json({ error: "Invalid or expired Clerk token" });
    }
  });

  // Keep the old GET callback route so existing links don't 404
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    res.redirect(302, "/");
  });
}

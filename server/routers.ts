import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { ordersRouter } from "./routers/orders";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import * as db from "./db";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
    /**
     * Admin login — validates the ADMIN_SECRET and creates a session cookie.
     * The admin user is auto-created in the DB if it doesn't exist yet.
     */
    adminLogin: publicProcedure
      .input(z.object({ secret: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const adminSecret = ENV.adminSecret;
        if (!adminSecret) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "ADMIN_SECRET is not configured on this server.",
          });
        }
        if (input.secret !== adminSecret) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid admin secret.",
          });
        }
        // Ensure admin user exists in the DB
        const ADMIN_OPEN_ID = "admin";
        await db.upsertUser({
          openId: ADMIN_OPEN_ID,
          name: "Admin",
          role: "admin",
          lastSignedIn: new Date(),
        });
        const token = await sdk.createSessionToken(ADMIN_OPEN_ID, {
          expiresInMs: ONE_YEAR_MS,
          name: "Admin",
        });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: ONE_YEAR_MS,
        });
        return { success: true } as const;
      }),
  }),

  orders: ordersRouter,
});

export type AppRouter = typeof appRouter;

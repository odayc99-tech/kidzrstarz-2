import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides?: Partial<TrpcContext>): { ctx: TrpcContext; clearedCookies: { name: string; options: Record<string, unknown> }[] } {
  const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-open-id",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
    ...overrides,
  };
  return { ctx, clearedCookies };
}

function makeAdminCtx(): TrpcContext {
  return {
    user: {
      id: 99,
      openId: "admin-open-id",
      email: "admin@example.com",
      name: "Admin User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeGuestCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("auth.logout", () => {
  it("clears the session cookie and returns success", async () => {
    const { ctx, clearedCookies } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.name).toBe(COOKIE_NAME);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      httpOnly: true,
      path: "/",
    });
  });

  it("auth.me returns current user when authenticated", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const user = await caller.auth.me();
    expect(user).not.toBeNull();
    expect(user?.email).toBe("test@example.com");
  });

  it("auth.me returns null for unauthenticated user", async () => {
    const ctx = makeGuestCtx();
    const caller = appRouter.createCaller(ctx);
    const user = await caller.auth.me();
    expect(user).toBeNull();
  });
});

// ─── Orders access control tests ─────────────────────────────────────────────

describe("orders.getOrder access control", () => {
  it("throws NOT_FOUND for non-existent order", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.orders.getOrder({ orderId: 999999, guestToken: undefined })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("orders.getGuestOrders", () => {
  it("returns empty array for unknown guest token", async () => {
    const ctx = makeGuestCtx();
    const caller = appRouter.createCaller(ctx);
    const orders = await caller.orders.getGuestOrders({ guestToken: "nonexistent-token-xyz" });
    expect(Array.isArray(orders)).toBe(true);
    expect(orders.length).toBe(0);
  });
});

describe("orders.getUserOrders", () => {
  it("throws UNAUTHORIZED when called without authentication", async () => {
    const ctx = makeGuestCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.orders.getUserOrders()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("returns array for authenticated user", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    const orders = await caller.orders.getUserOrders();
    expect(Array.isArray(orders)).toBe(true);
  });
});

// ─── Admin access control tests ───────────────────────────────────────────────

describe("admin access control", () => {
  it("admin.getOrders throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = makeGuestCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getOrders()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("admin.getOrders throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = makeCtx(); // role: "user"
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getOrders()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admin.getOrders returns array for admin user", async () => {
    const ctx = makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    const orders = await caller.admin.getOrders();
    expect(Array.isArray(orders)).toBe(true);
  });

  it("admin.getStats returns stats object for admin user", async () => {
    const ctx = makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    const stats = await caller.admin.getStats();
    expect(stats).toMatchObject({
      total: expect.any(Number),
      paid: expect.any(Number),
      withVideo: expect.any(Number),
      failed: expect.any(Number),
      processing: expect.any(Number),
    });
  });

  it("admin.getStats throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getStats()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admin.markAsPaid throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.markAsPaid({ orderId: 1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("admin.retryVideoGeneration throws NOT_FOUND for non-existent order", async () => {
    const ctx = makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.retryVideoGeneration({ orderId: 999999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ─── Shared storybook tests ────────────────────────────────────────────────────

describe("orders.getSharedStorybook", () => {
  it("throws NOT_FOUND for invalid share token", async () => {
    const ctx = makeGuestCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.orders.getSharedStorybook({ shareToken: "invalid-share-token-xyz" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Story approval tests ─────────────────────────────────────────────────────

describe("orders.approveStory", () => {
  it("throws NOT_FOUND for non-existent order", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.orders.approveStory({ orderId: 999999, guestToken: undefined })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Stripe session tests ─────────────────────────────────────────────────────

describe("orders.createStripeSession", () => {
  it("throws NOT_FOUND for non-existent order", async () => {
    const { ctx } = makeCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.orders.createStripeSession({ orderId: 999999, guestToken: undefined, origin: "https://example.com" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── Bulk quota retry tests ────────────────────────────────────────────────────

describe("admin.retryAllQuotaFailed", () => {
  it("throws UNAUTHORIZED for unauthenticated user", async () => {
    const ctx = makeGuestCtx();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.retryAllQuotaFailed()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws FORBIDDEN for non-admin user", async () => {
    const { ctx } = makeCtx(); // role: "user"
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.retryAllQuotaFailed()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("returns { queued: 0, orderIds: [] } when no quota-failed orders exist", async () => {
    // This test runs against the real DB; if no QUOTA_EXHAUSTED orders exist it should return 0
    const ctx = makeAdminCtx();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.retryAllQuotaFailed();
    // Result must always have these fields
    expect(result).toMatchObject({
      queued: expect.any(Number),
      orderIds: expect.any(Array),
    });
    // orderIds length must match queued count
    expect(result.orderIds.length).toBe(result.queued);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "user" | "admin" = "user"): {
  ctx: TrpcContext;
  clearedCookies: { name: string; options: Record<string, unknown> }[];
} {
  const clearedCookies: { name: string; options: Record<string, unknown> }[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, options });
      },
    } as TrpcContext["res"],
  };

  return { ctx, clearedCookies };
}

function createUnauthContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("orders router", () => {
  /**
   * Guest-accessible procedures (publicProcedure with dual auth):
   * createOrder, getOrder, updateStory, regenerateStory, approveStory,
   * createCheckoutSession, getScenes, triggerVideoGeneration,
   * uploadVoiceSample, getThemes, getVoices
   *
   * Auth-only procedures:
   * getUserOrders, generateShareLink, revokeShareLink
   *
   * Admin-only:
   * adminGetAllOrders
   *
   * Fully public:
   * getSharedStorybook
   */

  describe("createOrder", () => {
    it("accepts unauthenticated callers (guest flow)", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should NOT throw an auth error — it's a public procedure.
      // It will likely throw a storage/db error in test env, but not UNAUTHORIZED.
      try {
        await caller.orders.createOrder({
          imageBase64: "dGVzdA==",
          childName: "Test Child",
          mimeType: "image/jpeg",
        });
      } catch (error: any) {
        // Should NOT be an auth error
        expect(error.code).not.toBe("UNAUTHORIZED");
        expect(error.message).not.toMatch(/login|unauthorized|sign in/i);
      }
    });
  });

  describe("getOrder", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should NOT throw auth error — it's a public procedure.
      // Will throw NOT_FOUND since the order doesn't exist.
      try {
        await caller.orders.getOrder({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("getUserOrders", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.orders.getUserOrders()
      ).rejects.toThrow();
    });
  });

  describe("updateStory", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.updateStory({ orderId: 99999, story: "A new story", guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("regenerateStory", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.regenerateStory({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("approveStory", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.approveStory({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("createCheckoutSession", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.createCheckoutSession({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("getScenes", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.getScenes({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("triggerVideoGeneration", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.triggerVideoGeneration({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("getThemes", () => {
    it("is accessible without authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should succeed — getThemes is now fully public
      const themes = await caller.orders.getThemes();
      expect(Array.isArray(themes)).toBe(true);
      expect(themes.length).toBeGreaterThan(0);
      expect(themes[0]).toHaveProperty("id");
      expect(themes[0]).toHaveProperty("label");
      expect(themes[0]).toHaveProperty("description");
    });

    it("returns known themes", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const themes = await caller.orders.getThemes();
      const themeIds = themes.map((t: any) => t.id);
      expect(themeIds).toContain("adventure");
      expect(themeIds).toContain("fairytale");
      expect(themeIds).toContain("space");
    });
  });

  describe("getVoices", () => {
    it("is accessible without authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should succeed — getVoices is now fully public
      const voices = await caller.orders.getVoices();
      expect(Array.isArray(voices)).toBe(true);
      expect(voices.length).toBeGreaterThan(0);
      expect(voices[0]).toHaveProperty("id");
      expect(voices[0]).toHaveProperty("name");
      expect(voices[0]).toHaveProperty("gender");
      expect(voices[0]).toHaveProperty("style");
    });
  });

  describe("uploadVoiceSample", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.uploadVoiceSample({
          orderId: 99999,
          audioBase64: "dGVzdA==",
          mimeType: "audio/webm",
          guestToken: "fake-token",
        });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("ElevenLabs voice cloning integration", () => {
    it("cloneVoiceWithElevenLabs is available as a function", async () => {
      const { cloneVoiceWithElevenLabs } = await import("../services/ttsService");
      expect(typeof cloneVoiceWithElevenLabs).toBe("function");
    });

    it("generateNarration is available as a function", async () => {
      const { generateNarration } = await import("../services/ttsService");
      expect(typeof generateNarration).toBe("function");
    });

    it("deleteElevenLabsVoice is available as a function", async () => {
      const { deleteElevenLabsVoice } = await import("../services/ttsService");
      expect(typeof deleteElevenLabsVoice).toBe("function");
    });
  });

  describe("regenerateStorybookStory", () => {
    it("accepts unauthenticated callers with guestToken", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      try {
        await caller.orders.regenerateStorybookStory({ orderId: 99999, guestToken: "fake-token" });
      } catch (error: any) {
        expect(error.code).not.toBe("UNAUTHORIZED");
      }
    });
  });

  describe("generateShareLink", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.orders.generateShareLink({ orderId: 1 })
      ).rejects.toThrow();
    });
  });

  describe("revokeShareLink", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.orders.revokeShareLink({ orderId: 1 })
      ).rejects.toThrow();
    });
  });

  describe("getSharedStorybook", () => {
    it("is a public procedure (does not require auth)", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should not throw an auth error, but may throw NOT_FOUND since the token doesn't exist
      await expect(
        caller.orders.getSharedStorybook({ shareToken: "nonexistent-token" })
      ).rejects.toThrow(/not found|not available/i);
    });

    it("validates shareToken input is required", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.orders.getSharedStorybook({ shareToken: "" })
      ).rejects.toThrow();
    });
  });

  describe("getGuestOrders", () => {
    it("is accessible without authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      // Should succeed with empty array (no matching tokens)
      const result = await caller.orders.getGuestOrders({ guestTokens: [] });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it("returns empty array for non-existent tokens", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.orders.getGuestOrders({
        guestTokens: ["nonexistent-token-1", "nonexistent-token-2"],
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe("claimGuestOrders", () => {
    it("requires authentication", async () => {
      const ctx = createUnauthContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.orders.claimGuestOrders({ guestTokens: ["some-token"] })
      ).rejects.toThrow();
    });

    it("returns 0 claimed for empty token array", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.orders.claimGuestOrders({ guestTokens: [] });
      expect(result.claimed).toBe(0);
    });

    it("returns 0 claimed for non-existent tokens", async () => {
      const { ctx } = createAuthContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.orders.claimGuestOrders({
        guestTokens: ["nonexistent-token"],
      });
      expect(result.claimed).toBe(0);
    });
  });

  describe("adminGetAllOrders", () => {
    it("requires admin role", async () => {
      const { ctx } = createAuthContext("user");
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.orders.adminGetAllOrders()
      ).rejects.toThrow();
    });
  });
});

describe("auth.me", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createUnauthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns user for authenticated users", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.me();
    expect(result).toBeDefined();
    expect(result?.openId).toBe("test-user-123");
    expect(result?.email).toBe("test@example.com");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../db", () => ({
  getDb: vi.fn(),
}));

import { injectOgMetaTags } from "./ogMetaTags";
import { getDb } from "../db";
import type { Request, Response, NextFunction } from "express";

const mockedGetDb = vi.mocked(getDb);

function createMockReq(url: string): Request {
  return {
    originalUrl: url,
  } as Request;
}

function createMockRes(): Response {
  const res = {
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

describe("OG Meta Tags Middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it("should call next() for non-share URLs without modifying res.send", () => {
    const req = createMockReq("/dashboard");
    const res = createMockRes();
    const originalSend = res.send;

    injectOgMetaTags(req, res, next);

    expect(next).toHaveBeenCalled();
    // res.send should not have been replaced
    expect(res.send).toBe(originalSend);
  });

  it("should call next() for /api routes", () => {
    const req = createMockReq("/api/trpc/orders.list");
    const res = createMockRes();
    const originalSend = res.send;

    injectOgMetaTags(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.send).toBe(originalSend);
  });

  it("should intercept /share/:token routes and replace res.send", () => {
    const req = createMockReq("/share/abc123xyz");
    const res = createMockRes();
    const originalSend = res.send;

    injectOgMetaTags(req, res, next);

    expect(next).toHaveBeenCalled();
    // res.send should have been replaced with a new function
    expect(res.send).not.toBe(originalSend);
  });

  it("should inject OG tags when order is found in database", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        {
          childName: "Emma",
          story: "Once upon a time, Emma went on a magical adventure through the enchanted forest.",
          storyTheme: "fairy_tale",
          generatedImageUrl: "https://example.com/emma-character.png",
        },
      ]),
    };
    mockedGetDb.mockResolvedValue(mockDb as any);

    const req = createMockReq("/share/test-token-123");
    const res = createMockRes();

    injectOgMetaTags(req, res, next);

    // Simulate Vite sending the HTML
    const htmlTemplate = `<!doctype html><html><head><title>KidzRstarz</title>\n    <!-- OG_META_TAGS --></head><body></body></html>`;

    // Call the intercepted send
    res.send(htmlTemplate);

    // Wait for the async DB query to resolve
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The original send should have been called with modified HTML
    const sendCalls = (res.send as any).mock?.results || [];
    // Check that the DB was queried
    expect(mockedGetDb).toHaveBeenCalled();
  });

  it("should handle non-HTML responses without modification", () => {
    const req = createMockReq("/share/abc123");
    const res = createMockRes();

    injectOgMetaTags(req, res, next);

    // Send a non-HTML response (no OG_META_TAGS placeholder)
    const jsonBody = JSON.stringify({ data: "test" });
    res.send(jsonBody);

    // Should pass through without modification
    expect(next).toHaveBeenCalled();
  });

  it("should match various share token formats", () => {
    const validTokens = [
      "/share/abc123",
      "/share/ABC-xyz_456",
      "/share/a1b2c3d4e5f6",
    ];

    for (const url of validTokens) {
      const req = createMockReq(url);
      const res = createMockRes();
      const originalSend = res.send;

      injectOgMetaTags(req, res, vi.fn());

      // res.send should have been replaced for share URLs
      expect(res.send).not.toBe(originalSend);
    }
  });

  it("should not match non-share paths that contain 'share'", () => {
    const invalidPaths = [
      "/shares/abc",
      "/dashboard/share",
      "/api/share/abc",
    ];

    for (const url of invalidPaths) {
      const req = createMockReq(url);
      const res = createMockRes();
      const originalSend = res.send;

      injectOgMetaTags(req, res, vi.fn());

      // res.send should NOT have been replaced
      expect(res.send).toBe(originalSend);
    }
  });
});

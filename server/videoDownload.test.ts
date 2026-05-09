import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerVideoDownloadRoute } from "./routes/videoDownload";

// --- Mocks ---
vi.mock("./db", () => ({
  getOrderById: vi.fn(),
  getOrderByGuestToken: vi.fn(),
}));

// Mock the S3 SDK — getSignedUrl returns a fake pre-signed URL
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: vi.fn().mockImplementation(() => ({})),
  GetObjectCommand: vi.fn().mockImplementation((params) => ({ ...params })),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: vi.fn().mockResolvedValue(
    "https://kidzrstarz-upload.s3.us-east-2.amazonaws.com/orders/1/videos/test.mp4?X-Amz-Signature=abc"
  ),
}));

vi.mock("./_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
  },
}));

import { getOrderById, getOrderByGuestToken } from "./db";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sdk } from "./_core/sdk";

const mockOrder = {
  id: 1,
  userId: 42,
  childName: "Alice",
  videoKey: "orders/1/videos/test.mp4",
  videoUrl: "https://kidzrstarz-upload.s3.us-east-2.amazonaws.com/orders/1/videos/test.mp4",
  paymentStatus: "paid",
  status: "completed",
};

// Inject required env vars for S3 client
process.env.S3_REGION = "us-east-2";
process.env.S3_BUCKET = "kidzrstarz-upload";
process.env.AWS_ACCESS_KEY_ID = "test-key-id";
process.env.AWS_SECRET_ACCESS_KEY = "test-secret";

function buildApp() {
  const app = express();
  registerVideoDownloadRoute(app);
  return app;
}

describe("Video Download Route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply the mock after clearAllMocks
    vi.mocked(getSignedUrl).mockResolvedValue(
      "https://kidzrstarz-upload.s3.us-east-2.amazonaws.com/orders/1/videos/test.mp4?X-Amz-Signature=abc"
    );
  });

  it("returns 400 for invalid order ID", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/download/video/abc");
    expect(res.status).toBe(400);
  });

  it("returns 404 when order does not exist", async () => {
    vi.mocked(getOrderById).mockResolvedValue(null);
    const app = buildApp();
    const res = await request(app).get("/api/download/video/999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Order not found");
  });

  it("returns 403 when no auth and no guest token", async () => {
    vi.mocked(getOrderById).mockResolvedValue(mockOrder as never);
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("No session"));
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Unauthorized");
  });

  it("returns 403 when guest token does not match order", async () => {
    vi.mocked(getOrderById).mockResolvedValue(mockOrder as never);
    vi.mocked(getOrderByGuestToken).mockResolvedValue({ id: 999 } as never); // different order
    vi.mocked(sdk.authenticateRequest).mockRejectedValue(new Error("No session"));
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1?guestToken=badtoken");
    expect(res.status).toBe(403);
  });

  it("returns 404 when order has no video", async () => {
    vi.mocked(getOrderById).mockResolvedValue({
      ...mockOrder,
      videoKey: null,
      videoUrl: null,
    } as never);
    vi.mocked(getOrderByGuestToken).mockResolvedValue({ id: 1 } as never);
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1?guestToken=validtoken");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Video not ready yet");
  });

  it("allows authenticated owner to download — 302 redirect with pre-signed URL", async () => {
    vi.mocked(getOrderById).mockResolvedValue(mockOrder as never);
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ id: 42, role: "user" } as never);
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("X-Amz-Signature");
    expect(getSignedUrl).toHaveBeenCalled();
  });

  it("allows guest token holder to download — 302 redirect with pre-signed URL", async () => {
    vi.mocked(getOrderById).mockResolvedValue(mockOrder as never);
    vi.mocked(getOrderByGuestToken).mockResolvedValue({ id: 1 } as never);
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1?guestToken=validtoken").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("X-Amz-Signature");
  });

  it("returns 403 when authenticated user does not own the order", async () => {
    vi.mocked(getOrderById).mockResolvedValue(mockOrder as never); // userId: 42
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ id: 99, role: "user" } as never); // different user
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1");
    expect(res.status).toBe(403);
  });

  it("allows admin to download any order — 302 redirect with pre-signed URL", async () => {
    vi.mocked(getOrderById).mockResolvedValue(mockOrder as never); // userId: 42
    vi.mocked(sdk.authenticateRequest).mockResolvedValue({ id: 1, role: "admin" } as never);
    const app = buildApp();
    const res = await request(app).get("/api/download/video/1").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers["location"]).toContain("X-Amz-Signature");
  });
});

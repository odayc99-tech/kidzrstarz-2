import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mock heavy dependencies before importing the job module ──────────────────

vi.mock("../server/db", () => ({
  getOrderById: vi.fn(),
  updateOrder: vi.fn(),
  getScenesByOrderId: vi.fn(),
  updateScene: vi.fn(),
  createScene: vi.fn(),
  deleteScenesByOrderId: vi.fn(),
  getUserOrders: vi.fn(),
  getGuestOrders: vi.fn(),
  getAllOrders: vi.fn(),
  getOrderByShareToken: vi.fn(),
}));

vi.mock("../server/_core/imageGeneration", () => ({
  generateImage: vi.fn(),
}));

vi.mock("../server/_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

vi.mock("../server/services/storyGeneration", () => ({
  generateStory: vi.fn(),
}));

vi.mock("../server/services/sceneSplitter", () => ({
  splitStoryIntoScenes: vi.fn(),
}));

vi.mock("../server/services/ttsService", () => ({
  generateNarration: vi.fn(),
  cloneVoice: vi.fn(),
}));

vi.mock("../server/services/videoComposer", () => ({
  composeStorybookVideo: vi.fn(),
}));

vi.mock("../server/services/watermark", () => ({
  applyWatermark: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storagePut: vi.fn(),
  storageGetSignedUrl: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { scheduleQuotaRetry, getPendingQuotaRetries } from "./jobs/storybookJob";
import * as db from "./db";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("scheduleQuotaRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear the pending set between tests by draining it
    const pending = getPendingQuotaRetries() as Set<number>;
    pending.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("adds orderId to pendingQuotaRetries immediately", () => {
    scheduleQuotaRetry(99, "preview");
    expect(getPendingQuotaRetries().has(99)).toBe(true);
  });

  it("does not schedule a duplicate retry for the same orderId", () => {
    scheduleQuotaRetry(100, "preview");
    scheduleQuotaRetry(100, "preview"); // second call should be ignored
    // Only one entry in the set
    expect(getPendingQuotaRetries().size).toBe(1);
  });

  it("allows scheduling for different orderIds independently", () => {
    scheduleQuotaRetry(101, "preview");
    scheduleQuotaRetry(102, "scene_video");
    expect(getPendingQuotaRetries().has(101)).toBe(true);
    expect(getPendingQuotaRetries().has(102)).toBe(true);
    expect(getPendingQuotaRetries().size).toBe(2);
  });

  it("removes orderId from pending set after delay fires", async () => {
    const mockOrder = {
      id: 103,
      errorMessage: "QUOTA_EXHAUSTED: quota hit",
      status: "failed",
      generatedImageUrl: null,
      originalImageUrl: "https://example.com/photo.jpg",
      childName: "Aria",
      childAge: "5",
      storyTheme: "adventure",
      paymentStatus: "pending",
      voiceSampleUrl: null,
      elevenlabsVoiceId: null,
    };

    vi.mocked(db.getOrderById).mockResolvedValue(mockOrder as any);
    vi.mocked(db.updateOrder).mockResolvedValue(undefined);
    // Make runStorybookGeneration throw so we don't need to mock the full chain
    vi.mocked(db.getOrderById).mockResolvedValueOnce(mockOrder as any);

    scheduleQuotaRetry(103, "preview");
    expect(getPendingQuotaRetries().has(103)).toBe(true);

    // Advance timers by 5 minutes
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // orderId should be removed from the pending set after the timeout fires
    expect(getPendingQuotaRetries().has(103)).toBe(false);
  });

  it("skips retry if order no longer has QUOTA_EXHAUSTED error", async () => {
    const mockOrderRecovered = {
      id: 104,
      errorMessage: null, // already recovered
      status: "completed",
    };

    vi.mocked(db.getOrderById).mockResolvedValue(mockOrderRecovered as any);
    vi.mocked(db.updateOrder).mockResolvedValue(undefined);

    scheduleQuotaRetry(104, "scene_video");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // updateOrder should NOT have been called since the error is gone
    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("skips retry if order is not found", async () => {
    vi.mocked(db.getOrderById).mockResolvedValue(undefined);

    scheduleQuotaRetry(105, "preview");

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(db.updateOrder).not.toHaveBeenCalled();
  });

  it("resets order status to processing before re-running pipeline", async () => {
    const mockOrder = {
      id: 106,
      errorMessage: "QUOTA_EXHAUSTED: quota hit",
      status: "failed",
      generatedImageUrl: null,
      originalImageUrl: "https://example.com/photo.jpg",
      childName: "Aria",
      childAge: "5",
      storyTheme: "adventure",
      paymentStatus: "pending",
      voiceSampleUrl: null,
      elevenlabsVoiceId: null,
    };

    // First call: getOrderById for the retry check
    // Second call: getOrderById inside runStorybookGeneration
    vi.mocked(db.getOrderById).mockResolvedValue(mockOrder as any);
    vi.mocked(db.updateOrder).mockResolvedValue(undefined);
    // Make generateImage throw so the job fails fast without full pipeline
    const { generateImage } = await import("./_core/imageGeneration");
    vi.mocked(generateImage).mockRejectedValue(new Error("test abort"));

    scheduleQuotaRetry(106, "preview");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // updateOrder should have been called with { errorMessage: null, status: "processing" }
    expect(db.updateOrder).toHaveBeenCalledWith(106, { errorMessage: null, status: "processing" });
  });

  it("resets pending/failed scenes before re-running scene_video pipeline", async () => {
    const mockOrder = {
      id: 107,
      errorMessage: "QUOTA_EXHAUSTED: quota hit",
      status: "failed",
      generatedImageUrl: "https://example.com/char.jpg",
      originalImageUrl: "https://example.com/photo.jpg",
      childName: "Leo",
      childAge: "7",
      storyTheme: "space",
      paymentStatus: "paid",
      voiceSampleUrl: null,
      elevenlabsVoiceId: null,
    };

    const mockScenes = [
      { id: 1, sceneIndex: 0, status: "failed", illustrationUrl: null, narrationUrl: null },
      { id: 2, sceneIndex: 1, status: "pending", illustrationUrl: null, narrationUrl: null },
      { id: 3, sceneIndex: 2, status: "completed", illustrationUrl: "https://x.com/img.jpg", narrationUrl: "https://x.com/audio.mp3" },
    ];

    vi.mocked(db.getOrderById).mockResolvedValue(mockOrder as any);
    vi.mocked(db.updateOrder).mockResolvedValue(undefined);
    vi.mocked(db.getScenesByOrderId).mockResolvedValue(mockScenes as any);
    vi.mocked(db.updateScene).mockResolvedValue(undefined);
    // Make generateImage throw so the job fails fast without full pipeline
    const { generateImage } = await import("./_core/imageGeneration");
    vi.mocked(generateImage).mockRejectedValue(new Error("test abort"));

    scheduleQuotaRetry(107, "scene_video");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    // Only failed and pending scenes (id 1 and 2) should be reset; completed scene (id 3) should NOT
    expect(db.updateScene).toHaveBeenCalledWith(1, { status: "pending", illustrationUrl: null, narrationUrl: null });
    expect(db.updateScene).toHaveBeenCalledWith(2, { status: "pending", illustrationUrl: null, narrationUrl: null });
    expect(db.updateScene).not.toHaveBeenCalledWith(3, expect.anything());
  });

  it("manual retry before auto-retry fires prevents duplicate auto-retry (deduplication)", () => {
    // Schedule auto-retry for order 108
    scheduleQuotaRetry(108, "preview");
    expect(getPendingQuotaRetries().has(108)).toBe(true);

    // Simulate manual retry: user calls scheduleQuotaRetry again before the 5 min fires
    scheduleQuotaRetry(108, "preview");

    // Still only one entry — duplicate was ignored
    const count = Array.from(getPendingQuotaRetries()).filter((id) => id === 108).length;
    expect(count).toBe(1);
  });
});

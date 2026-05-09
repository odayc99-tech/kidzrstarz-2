/**
 * Tests for the activeJobs concurrency guard in storybookJob.ts.
 *
 * The guard prevents duplicate concurrent generation runs for the same orderId.
 * This is the root-cause fix for the quota exhaustion bug where both the Stripe
 * webhook and the Storybook page auto-trigger were firing runSceneGeneration
 * simultaneously, doubling image API calls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock all heavy dependencies so we can test the guard logic in isolation ─

vi.mock("../server/db", () => ({
  getOrderById: vi.fn(),
  updateOrder: vi.fn(),
  getScenesByOrderId: vi.fn(),
  updateScene: vi.fn(),
  createScene: vi.fn(),
  deleteScenesByOrderId: vi.fn(),
}));

vi.mock("../server/_core/imageGeneration", () => ({
  generateImage: vi.fn(),
}));

vi.mock("../server/services/ttsService", () => ({
  generateNarration: vi.fn(),
  cloneVoice: vi.fn(),
}));

vi.mock("../server/services/storyGeneration", () => ({
  generateStory: vi.fn(),
}));

vi.mock("../server/services/sceneSplitter", () => ({
  splitStoryIntoScenes: vi.fn(),
}));

vi.mock("../server/services/watermark", () => ({
  applyWatermark: vi.fn(),
}));

vi.mock("../server/services/videoComposer", () => ({
  composeStorybookVideo: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storagePut: vi.fn(),
  storageGetSignedUrl: vi.fn(),
}));

vi.mock("../server/_core/notification", () => ({
  notifyOwner: vi.fn(),
}));

import {
  runSceneGeneration,
  runStorybookGeneration,
  getActiveJobs,
  clearActiveJobs,
} from "./jobs/storybookJob";
import * as db from "./db";
import * as imageGen from "./_core/imageGeneration";
import * as tts from "./services/ttsService";
import * as storyGen from "./services/storyGeneration";
import * as sceneSplitter from "./services/sceneSplitter";
import * as watermark from "./services/watermark";
import * as storage from "./storage";

const mockGetOrderById = vi.mocked(db.getOrderById);
const mockUpdateOrder = vi.mocked(db.updateOrder);
const mockGetScenesByOrderId = vi.mocked(db.getScenesByOrderId);
const mockUpdateScene = vi.mocked(db.updateScene);
const mockDeleteScenesByOrderId = vi.mocked(db.deleteScenesByOrderId);
const mockGenerateImage = vi.mocked(imageGen.generateImage);
const mockGenerateNarration = vi.mocked(tts.generateNarration);
const mockGenerateStory = vi.mocked(storyGen.generateStory);
const mockSplitIntoScenes = vi.mocked(sceneSplitter.splitStoryIntoScenes);
const mockApplyWatermark = vi.mocked(watermark.applyWatermark);
const mockStoragePut = vi.mocked(storage.storagePut);
const mockStorageGetSignedUrl = vi.mocked(storage.storageGetSignedUrl);

const MOCK_ORDER_ID = 9001;

const mockOrder = {
  id: MOCK_ORDER_ID,
  childName: "Lily",
  storyTheme: "space",
  childAge: 5,
  originalImageUrl: "/manus-storage/uploads/test.png",
  generatedImageUrl: "/manus-storage/generated/char.png",
  story: "Once upon a time in space...",
  paymentStatus: "paid" as const,
  status: "paid" as const,
  guestToken: "tok123",
  shareToken: null,
  stripeSessionId: null,
  videoUrl: null,
  videoKey: null,
  voiceSampleUrl: null,
  elevenlabsVoiceId: null,
  errorMessage: null,
  userId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockScenes = [
  {
    id: 1,
    orderId: MOCK_ORDER_ID,
    sceneIndex: 1,
    sceneText: "Scene one text",
    illustrationUrl: null,
    narrationUrl: null,
    status: "pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  // CRITICAL: clear the module-level Set between tests to prevent state leakage
  clearActiveJobs();

  // Default happy-path mocks
  mockGetOrderById.mockResolvedValue(mockOrder);
  mockUpdateOrder.mockResolvedValue(undefined);
  mockGetScenesByOrderId.mockResolvedValue(mockScenes);
  mockUpdateScene.mockResolvedValue(undefined);
  mockStorageGetSignedUrl.mockResolvedValue({
    key: "uploads/test.png",
    url: "https://example.com/test.png",
  });
  mockGenerateImage.mockResolvedValue({ url: "https://example.com/img.png" });
  mockGenerateNarration.mockResolvedValue(Buffer.from("audio"));
  mockStoragePut.mockResolvedValue({
    key: "generated/img.png",
    url: "/manus-storage/generated/img.png",
  });
  mockApplyWatermark.mockResolvedValue(Buffer.from("watermarked"));
  mockDeleteScenesByOrderId.mockResolvedValue(undefined);
  mockGenerateStory.mockResolvedValue("A great story");
  mockSplitIntoScenes.mockResolvedValue([
    { sceneIndex: 1, sceneText: "Scene one text", title: "Scene 1" },
  ]);
});

describe("activeJobs concurrency guard", () => {
  describe("runSceneGeneration guard", () => {
    it("runs normally when no job is active for the orderId", async () => {
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);
      await runSceneGeneration(MOCK_ORDER_ID);
      expect(mockGetScenesByOrderId).toHaveBeenCalledWith(MOCK_ORDER_ID);
      expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    });

    it("skips the second concurrent call for the same orderId", async () => {
      // Make the first call slow so the second call arrives while it's in progress
      let resolveFirstCall!: () => void;
      const firstCallBarrier = new Promise<void>((res) => {
        resolveFirstCall = res;
      });

      mockGenerateImage.mockImplementationOnce(async () => {
        await firstCallBarrier;
        return { url: "https://example.com/img.png" };
      });

      // Start first call (does NOT await yet)
      const firstCall = runSceneGeneration(MOCK_ORDER_ID);

      // Give the first call time to enter the guard and add itself to activeJobs
      await new Promise((r) => setTimeout(r, 10));

      // Second call arrives while first is still running
      const secondCall = runSceneGeneration(MOCK_ORDER_ID);

      // Second call should resolve immediately (skipped)
      await secondCall;

      // First call should still be in progress (barrier not released yet)
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(true);

      // Release first call
      resolveFirstCall();
      await firstCall;

      // After completion, orderId should be removed from activeJobs
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);

      // generateImage should only have been called once (not twice)
      expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    });

    it("clears activeJobs even when a scene image generation fails all 3 retries", async () => {
      // runSceneGeneration catches per-scene errors internally (so a single scene
      // failure doesn't abort the whole job). The job resolves, but activeJobs
      // must still be cleared via the finally block.
      // Reject all 3 retry attempts so no 5-second inter-attempt delay fires.
      const networkErr = new Error("Network error");
      mockGenerateImage
        .mockRejectedValueOnce(networkErr)
        .mockRejectedValueOnce(networkErr)
        .mockRejectedValueOnce(networkErr);

      // Should resolve (not throw) — per-scene errors are caught internally
      await expect(runSceneGeneration(MOCK_ORDER_ID)).resolves.toBeUndefined();

      // activeJobs must be cleared after the job completes
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);
    }, 15000);

    it("allows a new run after the previous one completes", async () => {
      await runSceneGeneration(MOCK_ORDER_ID);
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);

      // Second sequential run should work fine
      await runSceneGeneration(MOCK_ORDER_ID);
      expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    });
  });

  describe("runStorybookGeneration guard", () => {
    it("runs normally when no job is active for the orderId", async () => {
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);
      await runStorybookGeneration(MOCK_ORDER_ID);
      expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    });

    it("skips the second concurrent call for the same orderId", async () => {
      let resolveFirstCall!: () => void;
      const firstCallBarrier = new Promise<void>((res) => {
        resolveFirstCall = res;
      });

      // Block on the very first async operation in runStorybookGeneration (generateStory)
      mockGenerateStory.mockImplementationOnce(async () => {
        await firstCallBarrier;
        return "A great story";
      });

      const firstCall = runStorybookGeneration(MOCK_ORDER_ID);
      // Give the first call time to enter the guard and add itself to activeJobs
      await new Promise((r) => setTimeout(r, 10));

      // Second call arrives while first is in progress
      const secondCall = runStorybookGeneration(MOCK_ORDER_ID);
      await secondCall; // should resolve immediately (skipped)

      // First call should still be in progress (barrier not released yet)
      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(true);

      resolveFirstCall();
      await firstCall;

      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);
      // generateImage should only have been called once
      expect(mockGenerateImage).toHaveBeenCalledTimes(1);
    });

    it("clears activeJobs even when a non-quota error is thrown", async () => {
      mockGenerateImage.mockRejectedValueOnce(new Error("AI error"));

      await expect(runStorybookGeneration(MOCK_ORDER_ID)).rejects.toThrow(
        "AI error"
      );

      expect(getActiveJobs().has(MOCK_ORDER_ID)).toBe(false);
    });
  });

  describe("cross-function guard isolation", () => {
    it("different orderIds can run concurrently without blocking each other", async () => {
      const ORDER_A = 9001;
      const ORDER_B = 9002;

      mockGetOrderById.mockImplementation(async (id) => ({
        ...mockOrder,
        id,
      }));
      mockGetScenesByOrderId.mockImplementation(async (id) => [
        { ...mockScenes[0], orderId: id },
      ]);

      // Both should run concurrently without interference
      await Promise.all([
        runSceneGeneration(ORDER_A),
        runSceneGeneration(ORDER_B),
      ]);

      // Both should complete and be removed from activeJobs
      expect(getActiveJobs().has(ORDER_A)).toBe(false);
      expect(getActiveJobs().has(ORDER_B)).toBe(false);

      // Both should have generated images (2 calls total)
      expect(mockGenerateImage).toHaveBeenCalledTimes(2);
    });
  });
});

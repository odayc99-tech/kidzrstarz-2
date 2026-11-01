import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generatePreviewImage: vi.fn(),
  getOrderById: vi.fn(),
  updateOrderWithPreview: vi.fn(),
  getDb: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  like: vi.fn(),
  isNull: vi.fn(),
  or: vi.fn(),
}));

vi.mock("../services/previewGeneration", () => ({
  generatePreviewImage: mocks.generatePreviewImage,
}));
vi.mock("../db", () => ({
  getOrderById: mocks.getOrderById,
  updateOrderWithPreview: mocks.updateOrderWithPreview,
  getDb: mocks.getDb,
}));
vi.mock("../../drizzle/schema", () => ({
  orders: { id: "orders.id", errorMessage: "orders.errorMessage", previewImageKey: "orders.previewImageKey" },
}));
vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  like: mocks.like,
  isNull: mocks.isNull,
  or: mocks.or,
}));

import {
  isPreviewGenerating,
  processPreviewGeneration,
  schedulePreviewGeneration,
} from "./previewGenerationJob";

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 22,
    originalImageKey: "orders/22/original.jpg",
    originalImageUrl: "https://legacy.example/original.jpg",
    previewImageKey: null,
    previewImageUrl: null,
    childName: "Test child",
    childDescription: null,
    userId: 7,
    errorMessage: null,
    ...overrides,
  };
}

function mockDatabaseUpdate() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { db: { update }, update, set, where };
}

describe("previewGenerationJob private-preview repair", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.eq.mockImplementation((...parts: unknown[]) => ({ eq: parts }));
    mocks.and.mockImplementation((...parts: unknown[]) => ({ and: parts }));
    mocks.like.mockImplementation((...parts: unknown[]) => ({ like: parts }));
    mocks.isNull.mockImplementation((field: unknown) => ({ isNull: field }));
    mocks.or.mockImplementation((...parts: unknown[]) => ({ or: parts }));
    mocks.getOrderById.mockResolvedValue(order());
    mocks.updateOrderWithPreview.mockResolvedValue(undefined);
    mocks.generatePreviewImage.mockResolvedValue({
      imageKey: "orders/22/previews/result.png",
      imageUrl: "https://private.example/previews/result.png",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards the stored original key, writes only preview fields, and clears a recovered Preview error", async () => {
    const database = mockDatabaseUpdate();
    mocks.getOrderById.mockResolvedValue(
      order({ errorMessage: "Preview: generation failed. Please try again." })
    );
    mocks.getDb.mockResolvedValue(database.db);

    await processPreviewGeneration(22);

    expect(mocks.generatePreviewImage).toHaveBeenCalledWith(
      "https://legacy.example/original.jpg",
      "Test child",
      7,
      22,
      null,
      "orders/22/original.jpg"
    );
    expect(mocks.updateOrderWithPreview).toHaveBeenCalledWith(22, {
      previewImageKey: "orders/22/previews/result.png",
      previewImageUrl: "https://private.example/previews/result.png",
    });
    expect(mocks.like).toHaveBeenCalledWith("orders.errorMessage", "Preview: %");
    expect(database.set).toHaveBeenCalledWith({ errorMessage: null });
    expect(isPreviewGenerating(22)).toBe(false);
  });

  it("skips an order that already has a preview without invoking generation", async () => {
    mocks.getOrderById.mockResolvedValue(
      order({ previewImageKey: "orders/22/previews/existing.png" })
    );

    await processPreviewGeneration(22);

    expect(mocks.generatePreviewImage).not.toHaveBeenCalled();
    expect(mocks.updateOrderWithPreview).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("does not clear a non-preview job error after a successful preview", async () => {
    mocks.getOrderById.mockResolvedValue(
      order({ errorMessage: "Video generation failed: unrelated error" })
    );

    await processPreviewGeneration(22);

    expect(mocks.updateOrderWithPreview).toHaveBeenCalledTimes(1);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("persists a generic Preview-prefixed error without provider details and leaves order/payment fields untouched", async () => {
    const database = mockDatabaseUpdate();
    mocks.getDb.mockResolvedValue(database.db);
    mocks.generatePreviewImage.mockRejectedValue(
      new Error("provider token=super-secret https://provider.example/private-photo.jpg")
    );

    await processPreviewGeneration(22);

    expect(mocks.updateOrderWithPreview).not.toHaveBeenCalled();
    expect(database.set).toHaveBeenCalledWith({
      errorMessage: "Preview: generation failed. Please try again.",
    });
    expect(JSON.stringify(database.set.mock.calls)).not.toContain("super-secret");
    expect(JSON.stringify(database.set.mock.calls)).not.toContain("provider.example");
    expect(isPreviewGenerating(22)).toBe(false);
  });

  it("prevents overlapping direct workers for the same order", async () => {
    let releaseGeneration: (() => void) | undefined;
    mocks.generatePreviewImage.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseGeneration = () =>
            resolve({
              imageKey: "orders/22/previews/result.png",
              imageUrl: "https://private.example/previews/result.png",
            });
        })
    );

    const first = processPreviewGeneration(22);
    await Promise.resolve();
    await Promise.resolve();
    expect(isPreviewGenerating(22)).toBe(true);

    await processPreviewGeneration(22);
    expect(mocks.generatePreviewImage).toHaveBeenCalledTimes(1);

    releaseGeneration?.();
    await first;
    expect(isPreviewGenerating(22)).toBe(false);
  });

  it("deduplicates queued timers and reports scheduled work through isPreviewGenerating", async () => {
    vi.useFakeTimers();
    let finishWorker: (() => void) | undefined;
    const workerFinished = new Promise<void>((resolve) => {
      finishWorker = resolve;
    });
    mocks.updateOrderWithPreview.mockImplementation(async () => {
      finishWorker?.();
    });

    await schedulePreviewGeneration(22);
    await schedulePreviewGeneration(22);
    expect(isPreviewGenerating(22)).toBe(true);

    await vi.advanceTimersByTimeAsync(500);
    await workerFinished;
    await Promise.resolve();
    expect(mocks.generatePreviewImage).toHaveBeenCalledTimes(1);
    expect(isPreviewGenerating(22)).toBe(false);
  });
});

describe("preview error preservation and canonical-key recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockImplementation((...parts: unknown[]) => ({ eq: parts }));
    mocks.and.mockImplementation((...parts: unknown[]) => ({ and: parts }));
    mocks.like.mockImplementation((...parts: unknown[]) => ({ like: parts }));
    mocks.isNull.mockImplementation((field: unknown) => ({ isNull: field }));
    mocks.or.mockImplementation((...parts: unknown[]) => ({ or: parts }));
    mocks.getOrderById.mockResolvedValue(order());
    mocks.updateOrderWithPreview.mockResolvedValue(undefined);
    mocks.generatePreviewImage.mockResolvedValue({ imageKey: "22/previews/recovered.png", imageUrl: "https://mock.invalid/recovered" });
  });
  it("recovers a URL-only preview by creating a canonical preview key", async () => {
    mocks.getOrderById.mockResolvedValue(order({ previewImageUrl: "https://stale.invalid/preview", previewImageKey: null }));
    await processPreviewGeneration(22);
    expect(mocks.generatePreviewImage).toHaveBeenCalledOnce();
    expect(mocks.updateOrderWithPreview).toHaveBeenCalledWith(22, { previewImageKey: "22/previews/recovered.png", previewImageUrl: "https://mock.invalid/recovered" });
  });
  it("restricts failed-preview writes to a missing preview and empty or preview-only error", async () => {
    const database = mockDatabaseUpdate();
    mocks.getDb.mockResolvedValue(database.db);
    mocks.getOrderById.mockResolvedValue(order({ errorMessage: "Unrelated job error" }));
    mocks.generatePreviewImage.mockRejectedValue(new Error("Mock failure"));
    await processPreviewGeneration(22);
    expect(database.where).toHaveBeenCalledWith({ and: [
      { eq: ["orders.id", 22] },
      { isNull: "orders.previewImageKey" },
      { or: [{ isNull: "orders.errorMessage" }, { like: ["orders.errorMessage", "Preview: %"] }] },
    ] });
  });
});

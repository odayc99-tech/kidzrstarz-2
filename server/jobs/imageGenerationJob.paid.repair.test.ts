import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generatePixarCharacter: vi.fn(),
  getOrderById: vi.fn(),
  getDb: vi.fn(),
  notifyOwner: vi.fn(),
  scheduleVideoGeneration: vi.fn(),
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  like: vi.fn(),
  lt: vi.fn(),
  or: vi.fn(),
}));

vi.mock("../services/imageGeneration", () => ({ generatePixarCharacter: mocks.generatePixarCharacter }));
vi.mock("../db", () => ({ getOrderById: mocks.getOrderById, getDb: mocks.getDb }));
vi.mock("../_core/notification", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("./videoGenerationJob", () => ({ scheduleVideoGeneration: mocks.scheduleVideoGeneration }));
vi.mock("../../drizzle/schema", () => ({
  orders: {
    id: "orders.id",
    paymentStatus: "orders.paymentStatus",
    generatedImageKey: "orders.generatedImageKey",
    generatedImageUrl: "orders.generatedImageUrl",
    status: "orders.status",
    updatedAt: "orders.updatedAt",
    errorMessage: "orders.errorMessage",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: mocks.and,
  eq: mocks.eq,
  inArray: mocks.inArray,
  isNull: mocks.isNull,
  like: mocks.like,
  lt: mocks.lt,
  or: mocks.or,
}));

import {
  isImageGenerating,
  processImageGeneration,
  scheduleImageGeneration,
} from "./imageGenerationJob";

const claimTime = new Date("2026-11-01T18:00:00.000Z");

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 22,
    status: "pending",
    paymentStatus: "paid",
    originalImageKey: "orders/22/original.jpg",
    originalImageUrl: "https://legacy.example/original.jpg",
    generatedImageKey: null,
    generatedImageUrl: null,
    videoKey: null,
    childName: "Test child",
    childDescription: "short curls",
    userId: 7,
    storyApproved: false,
    errorMessage: null,
    updatedAt: claimTime,
    ...overrides,
  };
}

function database(results: Array<unknown> = [{ affectedRows: 1 }, { affectedRows: 1 }]) {
  const where = vi.fn(() => Promise.resolve(results.shift() ?? { affectedRows: 1 }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { db: { update }, update, set, where };
}

function configureClaimableJob(options: {
  initial?: Record<string, unknown>;
  claimed?: Record<string, unknown>;
  updated?: Record<string, unknown>;
  results?: Array<unknown>;
} = {}) {
  const sql = database(options.results);
  mocks.getDb.mockResolvedValue(sql.db);
  mocks.getOrderById
    .mockResolvedValueOnce(order(options.initial))
    .mockResolvedValueOnce(order({ status: "processing", ...options.claimed }))
    .mockResolvedValueOnce(order({
      status: "completed",
      generatedImageKey: "orders/22/generated/final.png",
      ...options.updated,
    }));
  return sql;
}

describe("paid image worker duplicate and claim repair", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.and.mockImplementation((...parts: unknown[]) => ({ and: parts }));
    mocks.eq.mockImplementation((...parts: unknown[]) => ({ eq: parts }));
    mocks.inArray.mockImplementation((...parts: unknown[]) => ({ inArray: parts }));
    mocks.isNull.mockImplementation((field: unknown) => ({ isNull: field }));
    mocks.like.mockImplementation((...parts: unknown[]) => ({ like: parts }));
    mocks.lt.mockImplementation((...parts: unknown[]) => ({ lt: parts }));
    mocks.or.mockImplementation((...parts: unknown[]) => ({ or: parts }));
    mocks.generatePixarCharacter.mockResolvedValue({
      imageKey: "orders/22/generated/final.png",
      imageUrl: "https://storage.example/final.png",
    });
    mocks.notifyOwner.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards the stored original key, completes a claimed image, and waits for story approval before video", async () => {
    const sql = configureClaimableJob();

    await processImageGeneration(22);

    expect(mocks.generatePixarCharacter).toHaveBeenCalledWith(
      "https://legacy.example/original.jpg",
      "Test child",
      7,
      22,
      "short curls",
      "orders/22/original.jpg"
    );
    expect(sql.set).toHaveBeenNthCalledWith(1, { status: "processing" });
    expect(sql.set).toHaveBeenNthCalledWith(2, {
      generatedImageKey: "orders/22/generated/final.png",
      generatedImageUrl: "https://storage.example/final.png",
      status: "completed",
    });
    expect(mocks.scheduleVideoGeneration).not.toHaveBeenCalled();
    expect(isImageGenerating(22)).toBe(false);
  });

  it("deduplicates queued callbacks before the worker launches", async () => {
    vi.useFakeTimers();
    configureClaimableJob();

    await scheduleImageGeneration(22);
    await scheduleImageGeneration(22);
    expect(isImageGenerating(22)).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    expect(mocks.generatePixarCharacter).toHaveBeenCalledTimes(1);
    expect(isImageGenerating(22)).toBe(false);
  });

  it("deduplicates an overlapping active worker", async () => {
    configureClaimableJob();
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    mocks.generatePixarCharacter.mockImplementation(
      () => new Promise((resolve) => {
        markStarted?.();
        release = () => resolve({ imageKey: "orders/22/generated/final.png", imageUrl: "https://storage.example/final.png" });
      })
    );

    const first = processImageGeneration(22);
    await started;
    expect(isImageGenerating(22)).toBe(true);

    await processImageGeneration(22);
    expect(mocks.generatePixarCharacter).toHaveBeenCalledTimes(1);

    release?.();
    await first;
    expect(isImageGenerating(22)).toBe(false);
  });

  it("reuses an existing generated key without resetting status and only delegates guarded video recovery", async () => {
    mocks.getOrderById.mockResolvedValue(order({
      status: "processing",
      generatedImageKey: "orders/22/generated/existing.png",
      storyApproved: true,
      videoKey: null,
    }));

    await processImageGeneration(22);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.generatePixarCharacter).not.toHaveBeenCalled();
    expect(mocks.scheduleVideoGeneration).toHaveBeenCalledWith(22);
  });

  it("does not schedule a new video for an image-ready order that already has a video key", async () => {
    mocks.getOrderById.mockResolvedValue(order({
      generatedImageKey: "orders/22/generated/existing.png",
      storyApproved: true,
      videoKey: "orders/22/video/story.mp4",
    }));

    await processImageGeneration(22);

    expect(mocks.scheduleVideoGeneration).not.toHaveBeenCalled();
  });

  it("allows stale processing recovery through the database claim", async () => {
    configureClaimableJob({ initial: {
      status: "processing",
      updatedAt: new Date(Date.now() - 31 * 60 * 1000),
    } });

    await processImageGeneration(22);

    expect(mocks.lt).toHaveBeenCalledWith("orders.updatedAt", expect.any(Date));
    expect(mocks.generatePixarCharacter).toHaveBeenCalledTimes(1);
  });

  it("does not launch a provider request when the MySQL/Drizzle compare-and-set affects no rows", async () => {
    configureClaimableJob({ results: [{ affectedRows: 0 }] });

    await processImageGeneration(22);

    expect(mocks.generatePixarCharacter).not.toHaveBeenCalled();
    expect(mocks.getOrderById).toHaveBeenCalledTimes(1);
  });

  it.each(["unpaid", "refunded"])("does not claim or generate for a %s order", async (paymentStatus) => {
    mocks.getOrderById.mockResolvedValue(order({ paymentStatus }));

    await processImageGeneration(22);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.generatePixarCharacter).not.toHaveBeenCalled();
  });

  it("persists only a safe Image error and never clears payment or generated fields after a failure", async () => {
    const sql = configureClaimableJob({ results: [{ affectedRows: 1 }, { affectedRows: 1 }] });
    mocks.generatePixarCharacter.mockRejectedValue(new Error("provider secret and private URL"));

    await processImageGeneration(22);

    expect(sql.set).toHaveBeenNthCalledWith(2, {
      status: "failed",
      errorMessage: "Image: generation failed. Please try again.",
    });
    expect(JSON.stringify(sql.set.mock.calls)).not.toContain("provider secret");
    expect(JSON.stringify(sql.set.mock.calls)).not.toContain("generatedImageKey\":\"\"");
  });

  it("starts video only after the paid image is stored, story is approved, and no video key exists", async () => {
    configureClaimableJob({ updated: { storyApproved: true, videoKey: null } });

    await processImageGeneration(22);

    expect(mocks.scheduleVideoGeneration).toHaveBeenCalledWith(22);
  });
});

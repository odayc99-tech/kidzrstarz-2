import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(), sign: vi.fn(), schedule: vi.fn(), generating: vi.fn(), getDb: vi.fn(),
}));
vi.mock("../db", () => ({
  createOrder: vi.fn(), getOrderById: mocks.getOrder, getUserOrders: vi.fn(),
  updateOrderPayment: vi.fn(), updateOrderWithImage: vi.fn(), updateOrderStory: vi.fn(),
  getAllOrders: vi.fn(), getDb: mocks.getDb, getOrderByGuestToken: vi.fn(),
  getOrdersByGuestTokens: vi.fn(), claimGuestOrders: vi.fn(),
}));
vi.mock("../storage", () => ({
  storagePut: vi.fn(), storageGet: vi.fn(), storageGetSignedUrl: mocks.sign,
  storagePublicUrl: (key: string) => `https://unsigned.example.invalid/${key}`,
}));
vi.mock("../jobs/previewGenerationJob", () => ({ schedulePreviewGeneration: mocks.schedule, isPreviewGenerating: mocks.generating }));
vi.mock("../jobs/storyGenerationJob", () => ({ scheduleStoryGeneration: vi.fn() }));
vi.mock("../jobs/videoGenerationJob", () => ({ scheduleVideoGeneration: vi.fn(), isVideoGenerating: () => false }));
vi.mock("../services/ttsService", () => ({ getAvailableVoices: () => [] }));
vi.mock("../services/storyGeneration", () => ({ getAvailableThemes: () => [] }));
vi.mock("../services/storageNamespace", () => ({ getStorageNamespace: () => "mock" }));

import { ordersRouter } from "./orders";
let serial = 100;
let order: any;
const caller = (userId: number | null = 7) => ordersRouter.createCaller({
  user: userId === null ? null : { id: userId, role: "user" }, req: {}, res: {},
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  order = {
    id: ++serial, userId: 7, guestToken: "TEST_ONLY_GUEST_TOKEN", status: "pending",
    paymentStatus: "unpaid", storyApproved: false, story: "Mock story", errorMessage: null,
    originalImageKey: "7/originals/mock.jpg", originalImageUrl: "https://unsigned.example.invalid/original",
    previewImageKey: "7/previews/mock.png", previewImageUrl: "https://unsigned.example.invalid/preview",
    generatedImageKey: null, generatedImageUrl: null, videoKey: null, videoUrl: null,
  };
  mocks.getOrder.mockReset().mockImplementation(async () => order);
  mocks.sign.mockReset().mockImplementation(async (key: string) => ({ key, url: `https://signed.example.invalid/${key}` }));
  mocks.schedule.mockReset().mockResolvedValue(undefined);
  mocks.generating.mockReset().mockReturnValue(false);
  mocks.getDb.mockReset().mockImplementation(() => { throw new Error("Unexpected database operation in offline test"); });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network is forbidden"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(mocks.getDb).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("authorized original/preview links", () => {
  it("signs the stored keys only after loading an owner-authorized order", async () => {
    const events: string[] = [];
    mocks.getOrder.mockImplementation(async () => { events.push("load"); return order; });
    mocks.sign.mockImplementation(async (key) => { events.push("sign"); return { key, url: `https://signed.example.invalid/${key}` }; });
    const result = await caller().getOrder({ orderId: order.id });
    expect(events).toEqual(["load", "sign", "sign"]);
    expect(mocks.sign.mock.calls.map(call => call[0])).toEqual([order.originalImageKey, order.previewImageKey]);
    expect(result.originalImageUrl).toContain("signed.example.invalid");
    expect(result.previewImageUrl).toContain("signed.example.invalid");
    expect(result.story).toBe("Mock story");
    expect(result.previewError).toBeNull();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("permits a matching guest token without a login", async () => {
    await caller(null).getOrder({ orderId: order.id, guestToken: order.guestToken });
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });
  it.each([
    { userId: 999, token: undefined },
    { userId: null, token: undefined },
    { userId: null, token: "WRONG_TEST_TOKEN" },
  ])("denies an unauthorized caller before any signing", async ({ userId, token }) => {
    await expect(caller(userId).getOrder({ orderId: order.id, guestToken: token })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not fall back to an unsigned URL when a key is missing", async () => {
    order.originalImageKey = null;
    order.previewImageKey = null;
    const result = await caller().getOrder({ orderId: order.id });
    expect(result.originalImageUrl).toBeNull();
    expect(result.previewImageUrl).toBeNull();
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("keeps the story accessible and sanitizes a signing failure", async () => {
    mocks.sign.mockRejectedValueOnce(new Error("PRIVATE_SECRET_WITH_URL")).mockResolvedValueOnce({ url: "https://signed.example.invalid/preview" });
    const result = await caller().getOrder({ orderId: order.id });
    expect(result.originalImageUrl).toBeNull();
    expect(result.originalImageAccessError).toContain("temporarily unavailable");
    expect(result.story).toBe("Mock story");
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SECRET_WITH_URL");
  });
  it("reports only the recognized preview-error prefix as previewError", async () => {
    order.errorMessage = "Preview: Safe preview message";
    expect((await caller().getOrder({ orderId: order.id })).previewError).toBe("Safe preview message");
    order.errorMessage = "Unrelated job error";
    expect((await caller().getOrder({ orderId: order.id })).previewError).toBeNull();
  });
});

describe("explicit unpaid preview retry", () => {
  beforeEach(() => { order.previewImageKey = null; order.previewImageUrl = null; });
  it("schedules an existing owner-authorized order, without creating a new order", async () => {
    const result = await caller().retryPreview({ orderId: order.id });
    expect(result.scheduled).toBe(true);
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.schedule).toHaveBeenCalledWith(order.id);
  });
  it("permits matching guest access", async () => {
    await caller(null).retryPreview({ orderId: order.id, guestToken: order.guestToken });
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });
  it("does not schedule unauthorized orders", async () => {
    await expect(caller(999).retryPreview({ orderId: order.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not retry an in-flight preview", async () => {
    mocks.generating.mockReturnValue(true);
    expect((await caller().retryPreview({ orderId: order.id })).scheduled).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("does not retry an already successful preview", async () => {
    order.previewImageKey = "7/previews/already-ready.png";
    expect((await caller().retryPreview({ orderId: order.id })).scheduled).toBe(false);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it.each(["paid", "refunded"])("rejects %s orders instead of restarting a paid workflow", async (status) => {
    order.paymentStatus = status;
    await expect(caller().retryPreview({ orderId: order.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it("rate-limits repeated explicit retries even after a fast failure", async () => {
    await caller().retryPreview({ orderId: order.id });
    await expect(caller().retryPreview({ orderId: order.id })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });
});

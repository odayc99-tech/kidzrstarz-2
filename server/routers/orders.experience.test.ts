import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const m = vi.hoisted(() => ({
  getOrder: vi.fn(), createOrder: vi.fn(), put: vi.fn(), resolve: vi.fn(), save: vi.fn(), experience: vi.fn(), publicCatalog: vi.fn(),
  preview: vi.fn(), story: vi.fn(), privateUrl: vi.fn(), sign: vi.fn(), select: vi.fn(),
}));
vi.mock("../db", () => ({
  getOrderById: m.getOrder, createOrder: m.createOrder, getDb: vi.fn(async () => ({ select: m.select })),
  getUserOrders: vi.fn(), updateOrderPayment: vi.fn(), updateOrderWithImage: vi.fn(), updateOrderStory: vi.fn(), getAllOrders: vi.fn(),
  getOrderByGuestToken: vi.fn(), getOrdersByGuestTokens: vi.fn(), claimGuestOrders: vi.fn(),
}));
vi.mock("../storage", () => ({ storagePut: m.put, storageGet: vi.fn(), storagePublicUrl: vi.fn(), storageGetSignedUrl: m.sign }));
vi.mock("../services/privateMediaDelivery", () => ({ privateMediaUrl: m.privateUrl, privateDownloadUrl: vi.fn() }));
vi.mock("../services/experienceCatalog", () => ({ getPublicExperienceCatalog: m.publicCatalog, resolveNewOrderExperience: m.resolve, saveOrderExperience: m.save, getOrderExperience: m.experience }));
vi.mock("../jobs/imageGenerationJob", () => ({ scheduleImageGeneration: vi.fn() }));
vi.mock("../jobs/previewGenerationJob", () => ({ schedulePreviewGeneration: m.preview, isPreviewGenerating: () => false }));
vi.mock("../jobs/storyGenerationJob", () => ({ scheduleStoryGeneration: m.story }));
vi.mock("../jobs/videoGenerationJob", () => ({ scheduleVideoGeneration: vi.fn(), isVideoGenerating: () => false }));
vi.mock("../jobs/narrationRecoveryJob", () => ({ scheduleNarrationRecovery: vi.fn(), isNarrationRecovering: () => false, getNarrationRecoveryState: () => ({ pending: false, error: null }) }));
vi.mock("../services/ttsService", () => ({ getAvailableVoices: () => [] }));
vi.mock("../services/storyGeneration", () => ({ getAvailableThemes: () => [{ id: "adventure", label: "Adventure", description: "Classic" }] }));
vi.mock("../services/paymentContext", () => ({ getPaymentScope: vi.fn(), isStripeContextValid: vi.fn() }));
import { ordersRouter } from "./orders";

const snapshot = {
  version: 1 as const, createdAtIso: "2026-11-02T00:00:00.000Z",
  theme: { id: "snow-day", title: "Snow-Day Adventure", description: "Snow friends", category: "seasonal", icon: "snowflake", color: "cyan", storySetting: "PRIVATE WINTER SETTING", storyTone: "gentle", defaultMusicId: "magical-wonder", featured: false, sortOrder: 9, published: true },
  music: { id: "magical-wonder", label: "Magical Wonder", assetPath: "/audio/kidzrstarz/magical-wonder-v1.mp3", volume: 0.12 },
};
const order = { id: 4, userId: 7, guestToken: "GUEST", originalImageKey: "7/originals/photo.jpg", originalImageUrl: "old", storyTheme: "snow-day", paymentStatus: "paid", storyApproved: true, videoKey: "7/video.mp4", videoUrl: "old-video", generatedImageKey: "7/character.png", previewImageKey: null, voiceSampleKey: null, errorMessage: null, shareToken: "SHARE" };
const caller = (userId: number | null = 7) => ordersRouter.createCaller({ user: userId ? { id: userId, role: "user" } : null, req: {}, res: {} } as any);

beforeEach(() => {
  vi.clearAllMocks();
  m.getOrder.mockResolvedValue({ ...order }); m.createOrder.mockResolvedValue({ insertId: 10 });
  m.put.mockResolvedValue({ url: "https://example.invalid/photo" }); m.resolve.mockResolvedValue(snapshot); m.save.mockResolvedValue(undefined);
  m.experience.mockResolvedValue(snapshot); m.privateUrl.mockResolvedValue("https://example.invalid/signed"); m.sign.mockResolvedValue({ url: "https://example.invalid/signed" });
  m.select.mockImplementation(() => { const b: any = { from: () => b, where: () => b, limit: async () => [{ ...order }], orderBy: async () => [] }; return b; });
});

describe("new order experience", () => {
  it("validates theme/music and saves immutable settings before insertion and scheduling", async () => {
    await caller().createOrder({ imageBase64: "ZmFrZQ==", childName: "Test", storyTheme: "snow-day", musicId: "magical-wonder" });
    expect(m.resolve).toHaveBeenCalledWith("snow-day", "magical-wonder");
    expect(m.save).toHaveBeenCalledWith(expect.stringMatching(/^7\/originals\/.*-original\.jpg$/), snapshot);
    expect(m.resolve.mock.invocationCallOrder[0]).toBeLessThan(m.put.mock.invocationCallOrder[0]);
    expect(m.save.mock.invocationCallOrder[0]).toBeLessThan(m.createOrder.mock.invocationCallOrder[0]);
    expect(m.createOrder.mock.calls[0][0]).toMatchObject({ storyTheme: "snow-day", paymentStatus: "unpaid", amount: "19.99" });
    expect(m.preview).toHaveBeenCalledWith(10); expect(m.story).toHaveBeenCalledWith(10);
  });
  it("rejects hidden/unknown selections before uploads or order/jobs", async () => {
    m.resolve.mockRejectedValueOnce(new TRPCError({ code: "BAD_REQUEST", message: "Theme unavailable" }));
    await expect(caller().createOrder({ imageBase64: "ZmFrZQ==", childName: "Test", storyTheme: "hidden" })).rejects.toThrow("Theme unavailable");
    expect(m.put).not.toHaveBeenCalled(); expect(m.createOrder).not.toHaveBeenCalled(); expect(m.story).not.toHaveBeenCalled();
  });
  it("never creates/schedules an order if durable snapshot persistence fails", async () => {
    m.save.mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(caller().createOrder({ imageBase64: "ZmFrZQ==", childName: "Test" })).rejects.toThrow("AccessDenied");
    expect(m.createOrder).not.toHaveBeenCalled(); expect(m.preview).not.toHaveBeenCalled(); expect(m.story).not.toHaveBeenCalled();
  });
});

describe("authorized saved experience display", () => {
  it("returns frozen display/music but never private prompts", async () => {
    const result = await caller().getOrder({ orderId: 4 });
    expect(result.themeTitle).toBe("Snow-Day Adventure"); expect(result.musicSelection).toEqual(snapshot.music);
    expect(JSON.stringify(result)).not.toContain("PRIVATE WINTER SETTING");
  });
  it("never reads settings for an unauthorized order", async () => {
    await expect(caller(99).getOrder({ orderId: 4 })).rejects.toThrow("unauthorized"); expect(m.experience).not.toHaveBeenCalled();
  });
  it("supports the matching guest without exposing prompts", async () => {
    expect((await caller(null).getOrder({ orderId: 4, guestToken: "GUEST" })).musicSelection).toEqual(snapshot.music);
  });
  it("keeps undefined legacy music distinct from explicit no music", async () => {
    m.experience.mockResolvedValueOnce(null);
    expect((await caller().getOrder({ orderId: 4 })).musicSelection).toBeUndefined();
    m.experience.mockResolvedValueOnce({ ...snapshot, music: null });
    expect((await caller().getOrder({ orderId: 4 })).musicSelection).toBeNull();
  });
  it("shows settings failure without adopting a live default or hiding the order", async () => {
    m.experience.mockRejectedValueOnce(new Error("AccessDenied"));
    const result = await caller().getOrder({ orderId: 4 });
    expect(result.musicSelection).toBeNull(); expect(result.musicAccessError).toContain("temporarily unavailable"); expect(result.id).toBe(4);
  });
  it("returns safe music only after a paid share-token lookup", async () => {
    const result = await caller(null).getSharedStorybook({ shareToken: "SHARE" });
    expect(result.musicSelection).toEqual(snapshot.music); expect(JSON.stringify(result)).not.toContain("PRIVATE WINTER SETTING");
    m.select.mockImplementation(() => { const b: any = { from: () => b, where: () => b, limit: async () => [{ ...order, paymentStatus: "unpaid" }] }; return b; });
    m.experience.mockClear();
    await expect(caller(null).getSharedStorybook({ shareToken: "SHARE" })).rejects.toThrow("revoked"); expect(m.experience).not.toHaveBeenCalled();
  });
});

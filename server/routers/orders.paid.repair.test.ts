import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ order: vi.fn(), db: vi.fn(), sign: vi.fn(), download: vi.fn(), image: vi.fn(), pay: vi.fn(), stripeCreate: vi.fn(), stripeRetrieve: vi.fn() }));
vi.mock("../db", () => ({ createOrder: vi.fn(), getOrderById: m.order, getDb: m.db, getUserOrders: vi.fn(), updateOrderPayment: m.pay, updateOrderWithImage: vi.fn(), updateOrderStory: vi.fn(), getAllOrders: vi.fn(), getOrderByGuestToken: vi.fn(), getOrdersByGuestTokens: vi.fn(), claimGuestOrders: vi.fn() }));
vi.mock("../storage", () => ({ storagePut: vi.fn(), storageGet: vi.fn(), storagePublicUrl: vi.fn(), storageGetSignedUrl: vi.fn() }));
vi.mock("../services/privateMediaDelivery", () => ({ privateMediaUrl: m.sign, privateDownloadUrl: m.download }));
vi.mock("../jobs/previewGenerationJob", () => ({ schedulePreviewGeneration: vi.fn(), isPreviewGenerating: () => false }));
vi.mock("../jobs/storyGenerationJob", () => ({ scheduleStoryGeneration: vi.fn() }));
vi.mock("../jobs/videoGenerationJob", () => ({ scheduleVideoGeneration: vi.fn(), isVideoGenerating: () => false }));
vi.mock("../jobs/narrationRecoveryJob", () => ({ scheduleNarrationRecovery: vi.fn(), isNarrationRecovering: () => false, getNarrationRecoveryState: () => ({ pending: false, error: null }) }));
vi.mock("../jobs/imageGenerationJob", () => ({ scheduleImageGeneration: m.image }));
vi.mock("../services/ttsService", () => ({ getAvailableVoices: () => [] }));
vi.mock("../services/storyGeneration", () => ({ getAvailableThemes: () => [] }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { create: m.stripeCreate, retrieve: m.stripeRetrieve } }; } }));
import { ordersRouter } from "./orders";
import { getPaymentScope } from "../services/paymentContext";
let order: any;
let scene: any;
const caller = (id: number | null = 7) => ordersRouter.createCaller({ user: id === null ? null : { id, role: "user" }, req: { headers: {} }, res: {} } as any);
function database(rows: any[]) {
  const chain: any = {};
  for (const name of ["select", "from", "where", "orderBy", "limit"]) chain[name] = vi.fn(() => chain);
  chain.then = (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject);
  return { select: vi.fn(() => chain) };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_FAKE_ONLY");
  vi.stubEnv("RAILWAY_PROJECT_ID", "TEST_PROJECT"); vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "TEST_ENV"); vi.stubEnv("RAILWAY_SERVICE_ID", "TEST_SERVICE");
  order = { id: 3, userId: 7, guestToken: "FAKE_GUEST", paymentStatus: "paid", storyApproved: false, status: "completed", story: "A mock story", originalImageKey: "7/original.jpg", previewImageKey: "7/preview.png", generatedImageKey: "7/character.png", generatedImageUrl: "https://unsigned.invalid/character", videoKey: "7/video.mp4", videoUrl: "https://unsigned.invalid/video", voiceSampleKey: "7/voice.webm", errorMessage: null, childName: "Test" };
  scene = { id: 5, orderId: 3, sceneIndex: 0, sceneText: "A mock scene", illustrationKey: "7/scene.png", illustrationUrl: "https://unsigned.invalid/scene", narrationKey: "7/audio.mp3", narrationUrl: "https://unsigned.invalid/audio", status: "completed" };
  m.order.mockResolvedValue(order); m.db.mockResolvedValue(database([scene]));
  m.sign.mockImplementation(async (key, legacy) => key ? `https://signed.invalid/${key}` : legacy || null);
  m.download.mockResolvedValue({ downloadUrl: "https://signed.invalid/attachment", filename: "test.mp4" });
  m.stripeCreate.mockResolvedValue({ id: "cs_test_FAKE", url: "https://checkout.invalid/test" });
  m.stripeRetrieve.mockResolvedValue({ livemode: false, payment_status: "paid", payment_intent: "pi_FAKE", metadata: { order_id: "3", app_scope: getPaymentScope() } });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Forbidden live network"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("paid private-media API", () => {
  it("signs paid images, video and voice only from the authorized order; never resets keys", async () => {
    const result = await caller().getOrder({ orderId: 3 });
    expect(result.generatedImageUrl).toBe("https://signed.invalid/7/character.png"); expect(result.videoUrl).toBe("https://signed.invalid/7/video.mp4"); expect(result.voiceSampleUrl).toBe("https://signed.invalid/7/voice.webm"); expect(result.videoKey).toBe("7/video.mp4"); expect(m.db).not.toHaveBeenCalled();
  });
  it.each([999, null])("denies unauthorized private media before signing", async id => { await expect(caller(id).getOrder({ orderId: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.sign).not.toHaveBeenCalled(); });
  it("returns a safe access error without erasing a completed asset or queuing generation", async () => {
    m.sign.mockResolvedValue(null); const result = await caller().getOrder({ orderId: 3 }); expect(result.generatedImageAccessError).toContain("temporarily unavailable"); expect(result.generatedImageKey).toBe("7/character.png"); expect(result.videoKey).toBe("7/video.mp4"); expect(m.image).not.toHaveBeenCalled(); expect(m.db).not.toHaveBeenCalled();
  });
  it("signs scene illustrations and narration after matching guest access", async () => {
    const result = await caller(null).getScenes({ orderId: 3, guestToken: "FAKE_GUEST" }); expect(result[0].illustrationUrl).toBe("https://signed.invalid/7/scene.png"); expect(result[0].narrationUrl).toBe("https://signed.invalid/7/audio.mp3");
  });
  it("does not read scenes or sign links for the wrong guest", async () => {
    await expect(caller(null).getScenes({ orderId: 3, guestToken: "WRONG" })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.db).not.toHaveBeenCalled(); expect(m.sign).not.toHaveBeenCalled();
  });
  it("loads a paid share token without exposing original or voice media", async () => {
    let n = 0; const db = database([]); db.select.mockImplementation(() => database(++n === 1 ? [order] : [scene]).select()); m.db.mockResolvedValue(db);
    const result = await caller(null).getSharedStorybook({ shareToken: "VALID_SHARE" }); expect(result.generatedImageUrl).toContain("signed.invalid"); expect(result.scenes[0].narrationUrl).toContain("signed.invalid"); expect(result).not.toHaveProperty("originalImageKey"); expect(result).not.toHaveProperty("originalImageUrl"); expect(result).not.toHaveProperty("voiceSampleKey"); expect(result).not.toHaveProperty("guestToken");
  });
  it.each(["unpaid", "refunded"])("rejects a %s public share before signing", async status => {
    order.paymentStatus = status; m.db.mockResolvedValue(database([order])); await expect(caller(null).getSharedStorybook({ shareToken: "VALID_SHARE" })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.sign).not.toHaveBeenCalled();
  });
  it("rejects missing/revoked shares before signing", async () => { m.db.mockResolvedValue(database([])); await expect(caller(null).getSharedStorybook({ shareToken: "REVOKED" })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.sign).not.toHaveBeenCalled(); });
  it("signs character attachments only after owner/guest verification", async () => { await caller(null).getCharacterDownloadUrl({ orderId: 3, guestToken: "FAKE_GUEST" }); expect(m.download).toHaveBeenCalledWith("7/character.png", "test-animated-character.png", "image/png"); });
  it("does not sign unauthorized attachment requests", async () => { await expect(caller(999).getCharacterDownloadUrl({ orderId: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.download).not.toHaveBeenCalled(); });
  it("requires a paid valid share for video downloads", async () => { order.paymentStatus = "refunded"; m.db.mockResolvedValue(database([order])); await expect(caller(null).getSharedStorybookDownloadUrl({ shareToken: "VALID_SHARE" })).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(m.download).not.toHaveBeenCalled(); });
});
describe("scoped checkout verification", () => {
  it("tags both the checkout and payment intent with the staging scope", async () => { order.paymentStatus = "unpaid"; order.storyApproved = true; await caller().createCheckoutSession({ orderId: 3, origin: "https://staging.invalid" }); const body = m.stripeCreate.mock.calls[0][0]; expect(body.metadata.app_scope).toBe(getPaymentScope()); expect(body.payment_intent_data.metadata.app_scope).toBe(getPaymentScope()); });
  it.each([{ livemode: true, metadata: { order_id: "3" } }, { livemode: false, metadata: { order_id: "3", app_scope: "OTHER" } }])("rejects mismatched payment context before writes or generation", async bad => { order.paymentStatus = "unpaid"; m.stripeRetrieve.mockResolvedValue({ payment_status: "paid", ...bad }); await expect(caller().verifyStripeSession({ orderId: 3, sessionId: "cs_FAKE" })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(m.pay).not.toHaveBeenCalled(); expect(m.image).not.toHaveBeenCalled(); });
  it("verifies a correct scoped session and delegates to the guarded image worker", async () => { order.paymentStatus = "unpaid"; await caller().verifyStripeSession({ orderId: 3, sessionId: "cs_FAKE" }); expect(m.pay).toHaveBeenCalledOnce(); expect(m.image).toHaveBeenCalledOnce(); });
});

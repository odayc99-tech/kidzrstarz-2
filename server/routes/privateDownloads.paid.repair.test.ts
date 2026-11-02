import { beforeEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ order: vi.fn(), auth: vi.fn(), download: vi.fn() }));
vi.mock("../db", () => ({ getOrderById: m.order }));
vi.mock("../_core/sdk", () => ({ sdk: { authenticateRequest: m.auth } }));
vi.mock("../services/privateMediaDelivery", () => ({ privateDownloadUrl: m.download }));
import { registerPrivateDownloads } from "./privateDownloads";
let handler: any; let res: any; let order: any;
beforeEach(() => { vi.clearAllMocks(); registerPrivateDownloads({ get: (_path: any, h: any) => { handler = h; } } as any); res = { headersSent: false, status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), redirect: vi.fn(), setHeader: vi.fn() }; order = { id: 3, userId: 7, guestToken: "FAKE_GUEST", paymentStatus: "paid", generatedImageKey: "7/character.png", videoKey: "7/video.mp4", childName: "Test" }; m.order.mockResolvedValue(order); m.auth.mockResolvedValue({ id: 7, role: "user" }); m.download.mockResolvedValue({ downloadUrl: "https://signed.invalid/attachment" }); });
const request = (overrides: any = {}) => ({ params: { orderId: "3", type: "character" }, query: {}, ...overrides });
describe("authorized legacy download route", () => {
  it("redirects an owner to a canonical private attachment", async () => { await handler(request(), res); expect(m.download).toHaveBeenCalledWith("7/character.png", "test-animated-character.png", "image/png"); expect(res.redirect).toHaveBeenCalledWith(302, "https://signed.invalid/attachment"); expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store"); });
  it("permits matching guest access without a login", async () => { await handler(request({ query: { guestToken: "FAKE_GUEST" } }), res); expect(m.auth).not.toHaveBeenCalled(); expect(res.redirect).toHaveBeenCalledOnce(); });
  it("rejects another user before signing", async () => { m.auth.mockResolvedValue({ id: 999, role: "user" }); await handler(request(), res); expect(res.status).toHaveBeenCalledWith(403); expect(m.download).not.toHaveBeenCalled(); });
  it("rejects unauthenticated wrong guest access", async () => { m.auth.mockRejectedValue(new Error("no session")); await handler(request({ query: { guestToken: "WRONG" } }), res); expect(res.status).toHaveBeenCalledWith(403); expect(m.download).not.toHaveBeenCalled(); });
  it("does not serve an unpaid order", async () => { order.paymentStatus = "unpaid"; await handler(request(), res); expect(res.status).toHaveBeenCalledWith(403); expect(m.download).not.toHaveBeenCalled(); });
  it("rejects malformed IDs before any database or signer call", async () => { await handler(request({ params: { orderId: "3abc", type: "character" } }), res); expect(res.status).toHaveBeenCalledWith(400); expect(m.order).not.toHaveBeenCalled(); expect(m.download).not.toHaveBeenCalled(); });
});

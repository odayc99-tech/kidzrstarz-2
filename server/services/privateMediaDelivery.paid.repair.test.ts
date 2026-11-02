import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ sign: vi.fn(), sdkSign: vi.fn(), destroy: vi.fn(), makeClient: vi.fn(), compatible: vi.fn() }));
vi.mock("../storage", () => ({ storageGetSignedUrl: m.sign }));
vi.mock("./videoCompatibility", () => ({ ensureCompatibleVideoKey: m.compatible }));
vi.mock("@aws-sdk/client-s3", () => ({ S3Client: class { constructor(options: any) { m.makeClient(options); } destroy = m.destroy; }, GetObjectCommand: class { constructor(public input: any) {} } }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: m.sdkSign }));
import { privateMediaUrl, privateDownloadUrl } from "./privateMediaDelivery";
beforeEach(() => {
  vi.clearAllMocks();
  m.sign.mockResolvedValue({ url: "https://signed.invalid/view" });
  m.sdkSign.mockResolvedValue("https://signed.invalid/download");
  m.compatible.mockImplementation(async (key: string) => key);
  vi.stubEnv("S3_REGION", "us-east-1"); vi.stubEnv("S3_BUCKET", "TEST_BUCKET");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "FAKE_ACCESS"); vi.stubEnv("AWS_SECRET_ACCESS_KEY", "FAKE_SECRET");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Forbidden network"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("private delivery", () => {
  it("signs a canonical key instead of exposing its legacy URL", async () => {
    expect(await privateMediaUrl("7/photo.png", "https://unsigned.invalid")).toBe("https://signed.invalid/view");
    expect(m.sign).toHaveBeenCalledWith("7/photo.png");
  });
  it("does not fall back unsigned on signing failure", async () => {
    m.sign.mockRejectedValue(new Error("SECRET"));
    expect(await privateMediaUrl("7/photo.png", "https://unsigned.invalid")).toBeNull();
  });
  it("retains legacy-only records when no key exists", async () => {
    expect(await privateMediaUrl(null, "https://legacy.invalid")).toBe("https://legacy.invalid");
    expect(m.sign).not.toHaveBeenCalled();
  });
  it("signs canonical attachment headers for five minutes and destroys the client", async () => {
    const result = await privateDownloadUrl("/7/video.mp4", "test-story.mp4", "video/mp4");
    expect(result.filename).toBe("test-story.mp4");
    expect(m.compatible).toHaveBeenCalledWith("7/video.mp4");
    expect(m.sdkSign.mock.calls[0][1].input).toEqual({ Bucket: "TEST_BUCKET", Key: "7/video.mp4", ResponseContentDisposition: 'attachment; filename="test-story.mp4"', ResponseContentType: "video/mp4" });
    expect(m.sdkSign.mock.calls[0][2]).toEqual({ expiresIn: 300 });
    expect(m.destroy).toHaveBeenCalledOnce();
  });
  it("signs the compatible derivative without replacing the original video key", async () => {
    m.compatible.mockResolvedValue("7/video-compatible-h264420-v1.mp4");
    await privateDownloadUrl("7/video.mp4", "test-story.mp4", "video/mp4");
    expect(m.sdkSign.mock.calls[0][1].input.Key).toBe("7/video-compatible-h264420-v1.mp4");
  });
  it("does not sign or use an original fallback when compatibility preparation fails", async () => {
    m.compatible.mockRejectedValue(new Error("AccessDenied"));
    await expect(privateDownloadUrl("7/video.mp4", "test.mp4", "video/mp4")).rejects.toThrow("AccessDenied");
    expect(m.sdkSign).not.toHaveBeenCalled();
  });
  it("does not run video conversion for character image attachments", async () => {
    await privateDownloadUrl("7/photo.png", "test.png", "image/png");
    expect(m.compatible).not.toHaveBeenCalled();
  });
  it("cleans up after signing failure", async () => {
    m.sdkSign.mockRejectedValue(new Error("signing failed"));
    await expect(privateDownloadUrl("7/video.mp4", "test.mp4", "video/mp4")).rejects.toThrow("signing failed");
    expect(m.destroy).toHaveBeenCalledOnce();
  });
  it.each(["", "///", "https://attacker.invalid/key"])("rejects invalid stored keys before creating a client", async key => {
    await expect(privateDownloadUrl(key, "test.png", "image/png")).rejects.toThrow();
    expect(m.makeClient).not.toHaveBeenCalled();
  });
});

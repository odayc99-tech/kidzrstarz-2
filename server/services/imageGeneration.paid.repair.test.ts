import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  storageReadBytes: vi.fn(),
  storagePut: vi.fn(),
  applyBrandWatermark: vi.fn(),
  getStorageNamespace: vi.fn(),
}));

vi.mock("../_core/imageGeneration", () => ({ generateImage: mocks.generateImage }));
vi.mock("../storage", () => ({
  storageReadBytes: mocks.storageReadBytes,
  storagePut: mocks.storagePut,
}));
vi.mock("./watermark", () => ({ applyBrandWatermark: mocks.applyBrandWatermark }));
vi.mock("./storageNamespace", () => ({ getStorageNamespace: mocks.getStorageNamespace }));
vi.mock("nanoid", () => ({ nanoid: () => "mock-id" }));

import { generatePixarCharacter } from "./imageGeneration";

const originalFetch = globalThis.fetch;

describe("generatePixarCharacter paid private-media repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStorageNamespace.mockReturnValue("orders/22");
    mocks.applyBrandWatermark.mockImplementation(async (bytes: Buffer) => Buffer.from(`watermarked:${bytes}`));
    mocks.storagePut.mockResolvedValue({
      key: "orders/22/generated/mock-id-animated-character.png",
      url: "https://storage.example/generated.png",
    });
    globalThis.fetch = vi.fn(() => {
      throw new Error("Unexpected network request");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes the canonical original key to the SDK and reads a returned result key before watermarking", async () => {
    mocks.generateImage.mockResolvedValue({
      key: "provider/private-generated.png",
      url: "https://unsigned.example/never-use-this.png",
    });
    mocks.storageReadBytes.mockResolvedValue({
      key: "provider/private-generated.png",
      data: Buffer.from("generated-private-bytes"),
      contentType: "image/png",
    });

    await expect(
      generatePixarCharacter(
        "https://legacy.example/original.jpg",
        "Ava",
        7,
        22,
        "curly hair",
        "orders/22/original.jpg"
      )
    ).resolves.toEqual({
      imageKey: "orders/22/generated/mock-id-animated-character.png",
      imageUrl: "https://storage.example/generated.png",
    });

    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      originalImages: [{ storageKey: "orders/22/original.jpg", mimeType: "image/jpeg" }],
    }));
    expect(mocks.storageReadBytes).toHaveBeenCalledWith("provider/private-generated.png");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.applyBrandWatermark).toHaveBeenCalledWith(Buffer.from("generated-private-bytes"));
    expect(mocks.storagePut).toHaveBeenCalledWith(
      "orders/22/generated/mock-id-animated-character.png",
      Buffer.from("watermarked:generated-private-bytes"),
      "image/png"
    );
  });

  it("does not fall back to an unsigned result URL when a returned canonical key cannot be read", async () => {
    mocks.generateImage.mockResolvedValue({
      key: "provider/private-unavailable.png",
      url: "https://unsigned.example/should-not-be-fetched.png",
    });
    mocks.storageReadBytes.mockRejectedValue(new Error("private generated object unavailable"));

    await expect(
      generatePixarCharacter("https://legacy.example/original.jpg", "Ava", 7, 22, null, "orders/22/original.jpg")
    ).rejects.toThrow("private generated object unavailable");

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.applyBrandWatermark).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("uses the legacy URL input and result URL only when canonical keys are absent", async () => {
    mocks.generateImage.mockResolvedValue({ url: "https://legacy-provider.example/result.png" });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("legacy-result"),
    }) as unknown as typeof fetch;

    await generatePixarCharacter("https://legacy.example/original.jpg", "Ava", 7, 22);

    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      originalImages: [{ url: "https://legacy.example/original.jpg", mimeType: "image/jpeg" }],
    }));
    expect(globalThis.fetch).toHaveBeenCalledWith("https://legacy-provider.example/result.png");
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
  });
});

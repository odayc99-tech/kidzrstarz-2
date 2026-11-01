import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateImage: vi.fn(),
  storagePut: vi.fn(),
  storageReadBytes: vi.fn(),
  applyWatermark: vi.fn(),
  nanoid: vi.fn(),
  getStorageNamespace: vi.fn(),
}));

vi.mock("../_core/imageGeneration", () => ({ generateImage: mocks.generateImage }));
vi.mock("../storage", () => ({
  storagePut: mocks.storagePut,
  storageReadBytes: mocks.storageReadBytes,
}));
vi.mock("./watermark", () => ({ applyWatermark: mocks.applyWatermark }));
vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));
vi.mock("./storageNamespace", () => ({
  getStorageNamespace: mocks.getStorageNamespace,
}));

import { generatePreviewImage } from "./previewGeneration";

const originalFetch = globalThis.fetch;

describe("previewGeneration private-preview repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.nanoid.mockReturnValue("repair-preview-id");
    mocks.getStorageNamespace.mockReturnValue("orders/22");
    mocks.applyWatermark.mockImplementation(async (image: Buffer) =>
      Buffer.concat([Buffer.from("watermarked:"), image])
    );
    mocks.storagePut.mockResolvedValue({
      key: "orders/22/previews/repair-preview-id-preview.png",
      url: "https://private.example/previews/repair-preview-id-preview.png",
    });
    globalThis.fetch = vi.fn(() => {
      throw new Error("Unexpected network request in preview generation repair test");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes a private original key instead of its legacy URL and watermarks generated private bytes", async () => {
    mocks.generateImage.mockResolvedValue({
      key: "generated/private-result.png",
      url: "https://private.example/generated/private-result.png",
    });
    mocks.storageReadBytes.mockResolvedValue({
      key: "generated/private-result.png",
      data: Buffer.from("generated-private-bytes"),
      contentType: "image/png",
    });

    await expect(
      generatePreviewImage(
        "https://legacy.example/original.jpg",
        "Test child",
        7,
        22,
        null,
        "orders/22/original.jpg"
      )
    ).resolves.toEqual({
      imageKey: "orders/22/previews/repair-preview-id-preview.png",
      imageUrl: "https://private.example/previews/repair-preview-id-preview.png",
    });

    expect(mocks.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        originalImages: [
          { storageKey: "orders/22/original.jpg", mimeType: "image/jpeg" },
        ],
      })
    );
    expect(mocks.storageReadBytes).toHaveBeenCalledWith("generated/private-result.png");
    expect(mocks.applyWatermark).toHaveBeenCalledWith(Buffer.from("generated-private-bytes"));
    expect(mocks.storagePut).toHaveBeenCalledWith(
      "orders/22/previews/repair-preview-id-preview.png",
      Buffer.from("watermarked:generated-private-bytes"),
      "image/png"
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not downgrade to a result URL when a generated key is present but unreadable", async () => {
    mocks.generateImage.mockResolvedValue({
      key: "generated/unreadable.png",
      url: "https://external.example/should-not-be-fetched.png",
    });
    mocks.storageReadBytes.mockRejectedValue(new Error("private generated object unavailable"));
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generatePreviewImage(
        "https://legacy.example/original.jpg",
        "Test child",
        null,
        22
      )
    ).rejects.toThrow("private generated object unavailable");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.applyWatermark).not.toHaveBeenCalled();
  });

  it("uses a fetched external result only when the provider returned no storage key", async () => {
    mocks.generateImage.mockResolvedValue({
      url: "https://external.example/keyless-result.png",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => Buffer.from("external-result-bytes"),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generatePreviewImage(
      "https://legacy.example/original.jpg",
      "Test child",
      null,
      22
    );

    expect(mocks.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        originalImages: [
          { url: "https://legacy.example/original.jpg", mimeType: "image/jpeg" },
        ],
      })
    );
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("https://external.example/keyless-result.png");
    expect(mocks.applyWatermark).toHaveBeenCalledWith(Buffer.from("external-result-bytes"));
  });
});

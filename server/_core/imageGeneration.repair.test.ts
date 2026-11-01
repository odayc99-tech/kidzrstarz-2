import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    forgeApiUrl: "",
    forgeApiKey: "",
    openAiApiKey: "",
    openAiBaseUrl: "https://api.openai.com/v1",
  },
  storagePut: vi.fn(),
  storageReadBytes: vi.fn(),
}));

vi.mock("../storage", () => ({
  storagePut: mocks.storagePut,
  storageReadBytes: mocks.storageReadBytes,
}));

vi.mock("./env", () => ({ ENV: mocks.env }));

vi.mock("../services/retry", () => ({
  withRetry: async <T>(operation: () => Promise<T>) => operation(),
}));

import { generateImage } from "./imageGeneration";

const originalFetch = globalThis.fetch;

function providerResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe("imageGeneration private-original repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.env, {
      forgeApiUrl: "",
      forgeApiKey: "",
      openAiApiKey: "",
      openAiBaseUrl: "https://api.openai.com/v1",
    });
    mocks.storagePut.mockResolvedValue({
      key: "generated/canonical-output.png",
      url: "https://private.example/generated/canonical-output.png",
    });
    globalThis.fetch = vi.fn(() => {
      throw new Error("Unexpected network request in image generation repair test");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uses authenticated storage bytes and their MIME type for an OpenAI edit", async () => {
    Object.assign(mocks.env, { openAiApiKey: "test-openai-key" });
    mocks.storageReadBytes.mockResolvedValue({
      key: "orders/22/original.webp",
      data: Buffer.from("private-original-bytes"),
      contentType: "image/webp",
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/images/edits");
      const form = init?.body as FormData;
      const uploadedImage = form.get("image[]") as Blob;
      expect(uploadedImage.type).toBe("image/webp");
      expect(Buffer.from(await uploadedImage.arrayBuffer()).toString()).toBe(
        "private-original-bytes"
      );
      return providerResponse({
        data: [{ b64_json: Buffer.from("generated-image").toString("base64") }],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateImage({
        prompt: "safe test prompt",
        originalImages: [
          {
            storageKey: "orders/22/original.webp",
            url: "https://legacy.example/should-not-be-fetched.jpg",
            mimeType: "image/jpeg",
          },
        ],
      })
    ).resolves.toEqual({
      key: "generated/canonical-output.png",
      url: "https://private.example/generated/canonical-output.png",
    });

    expect(mocks.storageReadBytes).toHaveBeenCalledWith("orders/22/original.webp");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^generated\/\d+\.png$/),
      Buffer.from("generated-image"),
      "image/png"
    );
  });

  it("does not fall back to a legacy URL when a supplied private key cannot be read", async () => {
    Object.assign(mocks.env, { openAiApiKey: "test-openai-key" });
    mocks.storageReadBytes.mockRejectedValue(new Error("private object unavailable"));
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateImage({
        prompt: "safe test prompt",
        originalImages: [
          {
            storageKey: "orders/22/missing.jpg",
            url: "https://legacy.example/should-not-be-fetched.jpg",
          },
        ],
      })
    ).rejects.toThrow("private object unavailable");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("sends storage-resolved base64 and MIME metadata to Forge and returns its canonical storage key", async () => {
    Object.assign(mocks.env, {
      forgeApiUrl: "https://forge.example/api",
      forgeApiKey: "test-forge-key",
    });
    mocks.storageReadBytes.mockResolvedValue({
      key: "orders/22/original.webp",
      data: Buffer.from("forge-private-bytes"),
      contentType: "image/webp",
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        prompt: "safe Forge prompt",
        original_images: [
          {
            b64Json: Buffer.from("forge-private-bytes").toString("base64"),
            mimeType: "image/webp",
          },
        ],
      });
      return providerResponse({
        image: {
          b64Json: Buffer.from("forge-generated-image").toString("base64"),
          mimeType: "image/png",
        },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      generateImage({
        prompt: "safe Forge prompt",
        originalImages: [{ storageKey: "orders/22/original.webp" }],
      })
    ).resolves.toEqual({
      key: "generated/canonical-output.png",
      url: "https://private.example/generated/canonical-output.png",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^generated\/\d+\.png$/),
      Buffer.from("forge-generated-image"),
      "image/png"
    );
  });

  it("keeps legacy URL callers working when no storage key is supplied", async () => {
    Object.assign(mocks.env, { openAiApiKey: "test-openai-key" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from("legacy-image-bytes"),
      })
      .mockResolvedValueOnce(
        providerResponse({
          data: [{ b64_json: Buffer.from("generated-image").toString("base64") }],
        })
      );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generateImage({
      prompt: "safe test prompt",
      originalImages: [{ url: "https://external.example/reference.jpg", mimeType: "image/jpeg" }],
    });

    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://external.example/reference.jpg");
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.openai.com/v1/images/edits");
  });
});

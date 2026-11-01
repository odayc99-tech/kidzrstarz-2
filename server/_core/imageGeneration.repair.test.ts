import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    forgeApiUrl: "",
    forgeApiKey: "",
    openAiApiKey: "",
    openAiBaseUrl: "https://api.openai.com/v1",
    openAiImageModel: "gpt-image-2.5-sunburst",
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
      openAiImageModel: "gpt-image-2.5-sunburst",
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

  it("uses authenticated storage bytes and their MIME type for a default-model OpenAI edit", async () => {
    Object.assign(mocks.env, { openAiApiKey: "test-openai-key" });
    mocks.storageReadBytes.mockResolvedValue({
      key: "orders/22/original.webp",
      data: Buffer.from("private-original-bytes"),
      contentType: "image/webp",
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/images/edits");
      const form = init?.body as FormData;
      expect(form.get("model")).toBe("gpt-image-2.5-sunburst");
      expect(form.get("size")).toBe("1536x1024");
      expect(form.get("output_format")).toBe("png");
      expect(form.has("response_format")).toBe(false);
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

  it("uses the default model and PNG output format for OpenAI JSON generations", async () => {
    Object.assign(mocks.env, { openAiApiKey: "test-openai-key" });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://api.openai.com/v1/images/generations");
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({
        model: "gpt-image-2.5-sunburst",
        prompt: "safe generation prompt",
        size: "1536x1024",
        output_format: "png",
      });
      expect(payload).not.toHaveProperty("response_format");
      return providerResponse({
        data: [{ b64_json: Buffer.from("generated-json-image").toString("base64") }],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(generateImage({ prompt: "safe generation prompt" })).resolves.toEqual({
      key: "generated/canonical-output.png",
      url: "https://private.example/generated/canonical-output.png",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/^generated\/\d+\.png$/),
      Buffer.from("generated-json-image"),
      "image/png"
    );
  });

  it("forwards an explicitly configured image model for both OpenAI edits and generations", async () => {
    Object.assign(mocks.env, {
      openAiApiKey: "test-openai-key",
      openAiImageModel: "compatible-image-model",
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/images/edits")) {
        const form = init?.body as FormData;
        expect(form.get("model")).toBe("compatible-image-model");
        expect(form.get("size")).toBe("1536x1024");
        expect(form.get("output_format")).toBe("png");
        expect(form.has("response_format")).toBe(false);
        return providerResponse({
          data: [{ b64_json: Buffer.from("alternate-edit-image").toString("base64") }],
        });
      }

      expect(url).toBe("https://api.openai.com/v1/images/generations");
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({
        model: "compatible-image-model",
        prompt: "alternate generation prompt",
        size: "1536x1024",
        output_format: "png",
      });
      expect(payload).not.toHaveProperty("response_format");
      return providerResponse({
        data: [{ b64_json: Buffer.from("alternate-generation-image").toString("base64") }],
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generateImage({
      prompt: "alternate edit prompt",
      originalImages: [
        {
          b64Json: Buffer.from("alternate-edit-source").toString("base64"),
          mimeType: "image/png",
        },
      ],
    });
    await generateImage({ prompt: "alternate generation prompt" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.storagePut).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/^generated\/\d+\.png$/),
      Buffer.from("alternate-edit-image"),
      "image/png"
    );
    expect(mocks.storagePut).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/^generated\/\d+\.png$/),
      Buffer.from("alternate-generation-image"),
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

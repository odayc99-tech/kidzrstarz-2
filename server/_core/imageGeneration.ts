/**
 * Image generation helper.
 *
 * Strategy:
 *   1. If BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY are set → use Manus Forge
 *      ImageService (gRPC-web, JSON body with original_images as URL array).
 *      This is the path used on Manus hosting.
 *   2. Otherwise → use OpenAI Images API (multipart edits or generations).
 *      This is the path used on Railway / direct OpenAI.
 *
 * Example usage:
 *   const { url: imageUrl } = await generateImage({
 *     prompt: "A serene landscape with mountains"
 *   });
 *
 * For editing (animated character generation):
 *   const { url: imageUrl } = await generateImage({
 *     prompt: "Transform into 3D animated character",
 *     originalImages: [{ url: "https://...", mimeType: "image/jpeg" }]
 *   });
 */
import { storagePut } from "server/storage";
import { ENV } from "./env";
import { withRetry } from "../services/retry";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  url?: string;
};

export async function generateImage(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  // ── Path 1: Real OpenAI API key takes priority ───────────────────────────────
  // If OPENAI_API_KEY is a real OpenAI key (starts with sk- and not a Manus proxy
  // key), use OpenAI directly. This works on Railway and on Manus when a real key
  // is configured.
  if (ENV.openAiApiKey && !ENV.openAiBaseUrl.includes("manus.im")) {
    return generateImageViaOpenAI(options);
  }

  // ── Path 2: Manus Forge ImageService (fallback on Manus hosting) ─────────────
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    return generateImageViaForge(options);
  }

  // ── Path 3: OpenAI via Manus proxy (last resort — proxy may not support edits) ─
  if (ENV.openAiApiKey) {
    return generateImageViaOpenAI(options);
  }

  throw new Error(
    "Image generation is not configured. Set BUILT_IN_FORGE_API_URL + BUILT_IN_FORGE_API_KEY (Manus) or OPENAI_API_KEY (Railway)."
  );
}

// ── Manus Forge implementation ───────────────────────────────────────────────

async function generateImageViaForge(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const baseUrl = ENV.forgeApiUrl.endsWith("/")
    ? ENV.forgeApiUrl
    : `${ENV.forgeApiUrl}/`;
  const fullUrl = new URL("images.v1.ImageService/GenerateImage", baseUrl).toString();

  const result = await withRetry(
    async () => {
      const response = await fetch(fullUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "connect-protocol-version": "1",
          authorization: `Bearer ${ENV.forgeApiKey}`,
        },
        body: JSON.stringify({
          prompt: options.prompt,
          original_images: options.originalImages || [],
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Forge image generation failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
        );
      }
      return (await response.json()) as {
        image: { b64Json: string; mimeType: string };
      };
    },
    { label: "Forge image generation", maxRetries: 3, initialDelayMs: 3000 }
  );

  const buffer = Buffer.from(result.image.b64Json, "base64");
  const { url } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    result.image.mimeType
  );
  return { url };
}

// ── OpenAI implementation ────────────────────────────────────────────────────

async function generateImageViaOpenAI(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const baseUrl = ENV.openAiBaseUrl.replace(/\/$/, "");
  const hasOriginals = options.originalImages && options.originalImages.length > 0;
  const endpoint = hasOriginals
    ? `${baseUrl}/images/edits`
    : `${baseUrl}/images/generations`;

  if (hasOriginals) {
    // edits endpoint — multipart/form-data
    const form = new FormData();
    form.append("prompt", options.prompt);
    form.append("model", "gpt-image-1");
    form.append("size", "1536x1024");

    for (const img of options.originalImages!) {
      let buf: Buffer;
      if (img.b64Json) {
        buf = Buffer.from(img.b64Json, "base64");
      } else if (img.url) {
        // Download the image from the URL so we can attach it as a file
        const imgResp = await fetch(img.url);
        if (!imgResp.ok) {
          throw new Error(
            `Failed to fetch original image from URL: ${imgResp.statusText}`
          );
        }
        buf = Buffer.from(await imgResp.arrayBuffer());
      } else {
        throw new Error("originalImages entry must have either url or b64Json");
      }
      const mimeType = img.mimeType || "image/png";
      const ext = mimeType.includes("jpeg") ? "jpg" : "png";
      const blob = new Blob([new Uint8Array(buf)], { type: mimeType });
      form.append("image[]", blob, `image.${ext}`);
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${ENV.openAiApiKey}` },
      body: form as unknown as BodyInit,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Image edit failed (${response.status}): ${detail}`);
    }
    const result = (await response.json()) as { data: Array<{ b64_json: string }> };
    const b64 = result.data[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI edit endpoint");
    const buffer = Buffer.from(b64, "base64");
    const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
    return { url };
  } else {
    // generations endpoint — JSON body
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt: options.prompt,
        response_format: "b64_json",
        size: "1536x1024",
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Image generation failed (${response.status}): ${detail}`);
    }
    const result = (await response.json()) as { data: Array<{ b64_json: string }> };
    const b64 = result.data[0]?.b64_json;
    if (!b64) throw new Error("No image returned from OpenAI generation endpoint");
    const buffer = Buffer.from(b64, "base64");
    const { url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
    return { url };
  }
}

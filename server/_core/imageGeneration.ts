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
import { storagePut, storageReadBytes } from "../storage";
import { ENV } from "./env";
import { withRetry } from "../services/retry";

export type GenerateImageOptions = {
  prompt: string;
  originalImages?: Array<{
    url?: string;
    storageKey?: string;
    b64Json?: string;
    mimeType?: string;
  }>;
};

export type GenerateImageResponse = {
  key?: string;
  url?: string;
};

type ResolvedOriginalImage = Omit<
  NonNullable<GenerateImageOptions["originalImages"]>[number],
  "storageKey"
>;

function fileExtensionForMimeType(mimeType: string): string {
  if (mimeType.includes("jpeg")) return "jpg";

  const subtype = mimeType.split("/")[1]?.split(/[+;]/, 1)[0];
  return subtype && /^[a-z0-9]+$/i.test(subtype) ? subtype : "png";
}

/**
 * Resolve server-managed originals to bytes before sending them to an image
 * provider. A storage key is authoritative: if it cannot be read, do not
 * silently fall back to a legacy URL that may be inaccessible or public.
 */
async function resolveOriginalImages(
  originalImages: GenerateImageOptions["originalImages"]
): Promise<ResolvedOriginalImage[] | undefined> {
  if (!originalImages) return undefined;

  return Promise.all(
    originalImages.map(async (image): Promise<ResolvedOriginalImage> => {
      if (image.storageKey) {
        const storedImage = await storageReadBytes(image.storageKey);
        return {
          b64Json: storedImage.data.toString("base64"),
          mimeType: storedImage.contentType || image.mimeType || "image/png",
        };
      }

      return {
        url: image.url,
        b64Json: image.b64Json,
        mimeType: image.mimeType,
      };
    })
  );
}

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
  const originalImages = await resolveOriginalImages(options.originalImages);

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
          original_images: originalImages || [],
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
  const { key, url } = await storagePut(
    `generated/${Date.now()}.png`,
    buffer,
    result.image.mimeType
  );
  return { key, url };
}

// ── OpenAI implementation ────────────────────────────────────────────────────

async function generateImageViaOpenAI(
  options: GenerateImageOptions
): Promise<GenerateImageResponse> {
  const baseUrl = ENV.openAiBaseUrl.replace(/\/$/, "");
  const originalImages = await resolveOriginalImages(options.originalImages);
  const hasOriginals = originalImages && originalImages.length > 0;
  const endpoint = hasOriginals
    ? `${baseUrl}/images/edits`
    : `${baseUrl}/images/generations`;

  if (hasOriginals) {
    // edits endpoint — multipart/form-data
    const form = new FormData();
    form.append("prompt", options.prompt);
    form.append("model", ENV.openAiImageModel);
    form.append("size", "1536x1024");
    form.append("output_format", "png");

    for (const img of originalImages) {
      let buf: Buffer;
      if (img.b64Json) {
        buf = Buffer.from(img.b64Json, "base64");
      } else if (img.url) {
        // Download legacy external image URLs so we can attach them as files.
        const imgResp = await fetch(img.url);
        if (!imgResp.ok) {
          throw new Error(
            `Failed to fetch original image from URL: ${imgResp.statusText}`
          );
        }
        buf = Buffer.from(await imgResp.arrayBuffer());
      } else {
        throw new Error("originalImages entry must have either storageKey, url, or b64Json");
      }
      const mimeType = img.mimeType || "image/png";
      const ext = fileExtensionForMimeType(mimeType);
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
    const { key, url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
    return { key, url };
  } else {
    // generations endpoint — JSON body
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ENV.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: ENV.openAiImageModel,
        prompt: options.prompt,
        output_format: "png",
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
    const { key, url } = await storagePut(`generated/${Date.now()}.png`, buffer, "image/png");
    return { key, url };
  }
}

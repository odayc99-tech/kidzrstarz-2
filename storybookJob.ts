import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { generateImage } from "../_core/imageGeneration";
import { notifyOwner } from "../_core/notification";
import { createScene, deleteScenesByOrderId, getOrderById, getScenesByOrderId, updateOrder, updateScene } from "../db";
import { splitStoryIntoScenes } from "../services/sceneSplitter";
import { generateStory } from "../services/storyGeneration";
import { generateNarration, cloneVoice } from "../services/ttsService";
import { composeStorybookVideo } from "../services/videoComposer";
import { applyWatermark } from "../services/watermark";
import { storagePut, storageGetSignedUrl } from "../storage";

// ─── Concurrency guard ───────────────────────────────────────────────────────

/**
 * Track which orders currently have an active generation job running.
 * This prevents the Stripe webhook and the Storybook page auto-trigger from
 * both firing runSceneGeneration for the same order simultaneously, which would
 * double the image generation API calls and exhaust the quota.
 */
const activeJobs = new Set<number>();

/** Expose for testing */
export function getActiveJobs(): ReadonlySet<number> {
  return activeJobs;
}

/** Clear the activeJobs set — for test isolation only */
export function clearActiveJobs(): void {
  activeJobs.clear();
}

// ─── Quota auto-retry scheduler ───────────────────────────────────────────────

/** Delay before retrying a quota-exhausted order (5 minutes) */
const QUOTA_RETRY_DELAY_MS = 5 * 60 * 1000;

/** Track which orders already have a pending auto-retry scheduled to avoid duplicates */
const pendingQuotaRetries = new Set<number>();

type QuotaPipeline = "preview" | "scene_video";

/**
 * Schedule an automatic retry for a quota-exhausted order.
 * After QUOTA_RETRY_DELAY_MS the order status is reset and the appropriate
 * pipeline stage is re-run. Duplicate schedules for the same orderId are
 * silently ignored.
 */
export function scheduleQuotaRetry(orderId: number, pipeline: QuotaPipeline): void {
  if (pendingQuotaRetries.has(orderId)) {
    console.log(`[QuotaRetry] Auto-retry already scheduled for order ${orderId}, skipping duplicate`);
    return;
  }

  pendingQuotaRetries.add(orderId);
  const delayMinutes = Math.round(QUOTA_RETRY_DELAY_MS / 60000);
  console.log(`[QuotaRetry] Scheduling auto-retry for order ${orderId} (${pipeline}) in ${delayMinutes} minutes`);

  setTimeout(async () => {
    pendingQuotaRetries.delete(orderId);
    console.log(`[QuotaRetry] Auto-retrying order ${orderId} (${pipeline}) now`);

    try {
      // Verify the order still has a quota error before retrying
      const order = await getOrderById(orderId);
      if (!order) {
        console.warn(`[QuotaRetry] Order ${orderId} not found, skipping retry`);
        return;
      }

      if (!order.errorMessage?.includes("QUOTA_EXHAUSTED")) {
        console.log(`[QuotaRetry] Order ${orderId} no longer has a quota error (status: ${order.status}), skipping retry`);
        return;
      }

      // Reset the error and status
      await updateOrder(orderId, { errorMessage: null, status: "processing" });

      if (pipeline === "preview") {
        await runStorybookGeneration(orderId);
      } else {
        // Reset any pending/failed scenes before re-running
        const scenes = await getScenesByOrderId(orderId);
        for (const scene of scenes) {
          if (scene.status === "pending" || scene.status === "failed") {
            await updateScene(scene.id, { status: "pending", illustrationUrl: null, narrationUrl: null });
          }
        }
        await runSceneGeneration(orderId);
        await runVideoGeneration(orderId);
      }

      console.log(`[QuotaRetry] Auto-retry succeeded for order ${orderId}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[QuotaRetry] Auto-retry failed for order ${orderId}:`, errMsg);

      // If it's still a quota error, schedule another retry
      if (errMsg.includes("QUOTA_EXHAUSTED")) {
        console.log(`[QuotaRetry] Still quota-exhausted for order ${orderId}, scheduling another retry`);
        scheduleQuotaRetry(orderId, pipeline);
      }
    }
  }, QUOTA_RETRY_DELAY_MS);
}

/** Expose the pending set for testing purposes */
export function getPendingQuotaRetries(): ReadonlySet<number> {
  return pendingQuotaRetries;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a possibly-relative /manus-storage/... URL to an absolute HTTPS URL
 * that external services (like the Forge image generation API) can download.
 * If the URL is already absolute (starts with http/https), it is returned as-is.
 */
async function resolveImageUrl(url: string): Promise<string> {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    return url;
  }
  // Extract the storage key from /manus-storage/<key>
  const key = url.replace(/^\/manus-storage\//, "");
  return storageGetSignedUrl(key);
}

// ─── Pipeline stages ──────────────────────────────────────────────────────────

export async function runStorybookGeneration(orderId: number): Promise<void> {
  // Prevent duplicate concurrent runs for the same order
  if (activeJobs.has(orderId)) {
    console.log(`[StorybookJob] Generation already in progress for order ${orderId}, skipping duplicate`);
    return;
  }
  activeJobs.add(orderId);
  console.log(`[StorybookJob] Starting generation for order ${orderId}`);

  const order = await getOrderById(orderId);
  if (!order) {
    activeJobs.delete(orderId);
    throw new Error(`Order ${orderId} not found`);
  }
  if (!order.originalImageUrl) {
    activeJobs.delete(orderId);
    throw new Error("No original image URL");
  }

  await updateOrder(orderId, { status: "processing", errorMessage: null });

  try {
    // Step 1: Generate Pixar-style character image
    console.log(`[StorybookJob] Generating character image for order ${orderId}`);
    const characterPrompt = `Transform this child's photo into a stunning Pixar/Disney 3D animated character. 
    The character should look like the child but in Pixar animation style with:
    - Expressive, large eyes with detailed irises
    - Smooth, stylized skin with warm subsurface scattering
    - Detailed, stylized hair
    - Warm, cinematic lighting
    - Clean, professional Pixar movie quality
    - Friendly, heroic pose
    - Vibrant, saturated colors
    Keep the child's distinctive features (hair color, eye color, facial structure) but render in Pixar 3D style.`;

    const resolvedOriginalUrl = await resolveImageUrl(order.originalImageUrl);
    let genResult: { url?: string };
    try {
      genResult = await generateImage({
        prompt: characterPrompt,
        originalImages: [{ url: resolvedOriginalUrl, mimeType: "image/jpeg" }],
      });
    } catch (imgErr) {
      const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
      if (errMsg.includes("usage_exhausted") || errMsg.includes("usage exhausted")) {
        const quotaMsg = "QUOTA_EXHAUSTED: Image generation quota is temporarily exhausted. Auto-retry scheduled in ~5 minutes.";
        await updateOrder(orderId, { errorMessage: quotaMsg });
        scheduleQuotaRetry(orderId, "preview");
        throw new Error(quotaMsg);
      }
      throw imgErr;
    }
    const generatedImageUrl = genResult.url!;

    await updateOrder(orderId, { generatedImageUrl });
    console.log(`[StorybookJob] Character generated: ${generatedImageUrl}`);

    // Step 2: Generate story
    console.log(`[StorybookJob] Generating story for order ${orderId}`);
    const { story, characterDescription } = await generateStory({
      childName: order.childName || "the child",
      childAge: order.childAge || "5",
      theme: order.storyTheme || "adventure",
      characterImageUrl: generatedImageUrl,
    });

    await updateOrder(orderId, { story });
    console.log(`[StorybookJob] Story generated for order ${orderId}`);

    // Step 3: Split into scenes
    const scenes = await splitStoryIntoScenes({
      story,
      characterDescription,
      theme: order.storyTheme || "adventure",
      childName: order.childName || "the child",
    });

    // Clear any existing scenes
    await deleteScenesByOrderId(orderId);

    // Create scene records
    for (const scene of scenes) {
      await createScene({
        orderId,
        sceneIndex: scene.sceneIndex,
        sceneText: scene.sceneText,
        illustrationPrompt: scene.illustrationPrompt,
        status: "pending",
      });
    }

    // Mark order as completed (preview ready, awaiting payment)
    await updateOrder(orderId, { status: "completed" });
    console.log(`[StorybookJob] Preview generation complete for order ${orderId}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[StorybookJob] Failed for order ${orderId}:`, err);
    // Only update status to failed if it's not a quota error (quota errors set their own status)
    if (!errorMessage.includes("QUOTA_EXHAUSTED")) {
      await updateOrder(orderId, { status: "failed", errorMessage });
    } else {
      await updateOrder(orderId, { status: "failed" });
    }
    throw err;
  } finally {
    activeJobs.delete(orderId);
  }
}

export async function runSceneGeneration(orderId: number): Promise<void> {
  // Prevent duplicate concurrent runs for the same order
  if (activeJobs.has(orderId)) {
    console.log(`[SceneJob] Generation already in progress for order ${orderId}, skipping duplicate`);
    return;
  }
  activeJobs.add(orderId);
  console.log(`[SceneJob] Starting scene generation for order ${orderId}`);

  const order = await getOrderById(orderId);
  if (!order) {
    activeJobs.delete(orderId);
    throw new Error(`Order ${orderId} not found`);
  }

  const scenes = await getScenesByOrderId(orderId);
  if (scenes.length === 0) {
    activeJobs.delete(orderId);
    throw new Error("No scenes found");
  }

  try {
  // Optional: Clone voice if voice sample provided
  let voiceId: string | undefined;
  if (order.voiceSampleUrl && !order.elevenlabsVoiceId) {
    console.log(`[SceneJob] Cloning voice for order ${orderId}`);
    const clonedVoiceId = await cloneVoice({
      voiceSampleUrl: order.voiceSampleUrl,
      childName: order.childName || "the child",
    });
    if (clonedVoiceId) {
      await updateOrder(orderId, { elevenlabsVoiceId: clonedVoiceId });
      voiceId = clonedVoiceId;
    }
  } else if (order.elevenlabsVoiceId) {
    voiceId = order.elevenlabsVoiceId;
  }

  // Process each pending scene
  for (const scene of scenes) {
    if (scene.status === "completed") {
      console.log(`[SceneJob] Scene ${scene.sceneIndex} already completed, skipping`);
      continue;
    }

    try {
      console.log(`[SceneJob] Processing scene ${scene.sceneIndex} for order ${orderId}`);
      await updateScene(scene.id, { status: "generating_image" });

      // Generate illustration
      const illustrationPrompt = `${scene.illustrationPrompt}
      Style: Pixar/Disney 3D animation, cinematic lighting, vibrant colors, high quality, 16:9 aspect ratio`;

      const resolvedCharacterUrl = order.generatedImageUrl
        ? await resolveImageUrl(order.generatedImageUrl)
        : undefined;

      // Retry image generation up to 3 times on transient errors
      // Quota exhaustion (usage_exhausted) is NOT retried — stop immediately and schedule auto-retry
      let illResult: { url?: string } = {};
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          illResult = await generateImage({
            prompt: illustrationPrompt,
            originalImages: resolvedCharacterUrl
              ? [{ url: resolvedCharacterUrl, mimeType: "image/jpeg" }]
              : undefined,
          });
          break;
        } catch (imgErr) {
          const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr);
          // Quota exhaustion — no point retrying, schedule auto-retry and surface immediately
          if (errMsg.includes("usage_exhausted") || errMsg.includes("usage exhausted")) {
            const quotaMsg = "QUOTA_EXHAUSTED: Image generation quota is temporarily exhausted. Auto-retry scheduled in ~5 minutes.";
            await updateOrder(orderId, { errorMessage: quotaMsg });
            await updateScene(scene.id, { status: "failed" });
            scheduleQuotaRetry(orderId, "scene_video");
            throw new Error("QUOTA_EXHAUSTED");
          }
          if (attempt === 3) throw imgErr;
          console.warn(`[SceneJob] Image gen attempt ${attempt} failed for scene ${scene.sceneIndex}, retrying in 5s...`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      const rawIllustrationUrl = illResult.url!;

      // Apply watermark
      const illustrationUrl: string = await applyWatermark({
        imageUrl: rawIllustrationUrl,
        orderId,
        sceneIndex: scene.sceneIndex,
      });

      await updateScene(scene.id, { illustrationUrl, status: "generating_audio" });

      // Generate narration
      const narrationUrl = await generateNarration({
        text: scene.sceneText || "",
        orderId,
        sceneIndex: scene.sceneIndex,
        voiceId,
      });

      await updateScene(scene.id, { narrationUrl, status: "completed" });
      console.log(`[SceneJob] Scene ${scene.sceneIndex} completed for order ${orderId}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[SceneJob] Scene ${scene.sceneIndex} failed for order ${orderId}:`, err);
      if (!errorMessage.includes("QUOTA_EXHAUSTED")) {
        await updateScene(scene.id, { status: "failed" });
      }
      // Re-throw quota errors to stop the loop
      if (errorMessage.includes("QUOTA_EXHAUSTED")) throw err;
    }
  }

  console.log(`[SceneJob] All scenes processed for order ${orderId}`);
  } finally {
    activeJobs.delete(orderId);
  }
}


export async function runVideoGeneration(orderId: number): Promise<void> {
  console.log(`[VideoJob] Starting MP4 video generation for order ${orderId}`);

  const order = await getOrderById(orderId);
  if (!order) throw new Error(`Order ${orderId} not found`);

  // Temp file path for the composed MP4
  const tmpMp4 = path.join(os.tmpdir(), `kidzrstarz_order_${orderId}_${Date.now()}.mp4`);

  try {
    await updateOrder(orderId, { errorMessage: null });

    const scenes = await getScenesByOrderId(orderId);
    const completedScenes = scenes
      .filter((s) => s.status === "completed" && s.illustrationUrl && s.narrationUrl)
      .sort((a, b) => a.sceneIndex - b.sceneIndex);

    if (completedScenes.length === 0) {
      throw new Error("No completed scenes available for video generation");
    }

    console.log(`[VideoJob] Composing MP4 from ${completedScenes.length} scenes for order ${orderId}`);

    // Compose the real MP4 using ffmpeg
    await composeStorybookVideo({
      orderId,
      childName: order.childName || "the child",
      storyTheme: order.storyTheme || "adventure",
      scenes: completedScenes.map((s) => ({
        sceneIndex: s.sceneIndex,
        sceneText: s.sceneText,
        illustrationUrl: s.illustrationUrl!,
        narrationUrl: s.narrationUrl!,
      })),
      outputPath: tmpMp4,
    });

    console.log(`[VideoJob] MP4 composed, uploading to storage for order ${orderId}`);

    // Upload the MP4 to storage
    const mp4Buffer = fs.readFileSync(tmpMp4);
    const key = `orders/${orderId}/storybook_video.mp4`;
    const { url: videoUrl } = await storagePut(key, mp4Buffer, "video/mp4");

    await updateOrder(orderId, {
      videoKey: key,
      videoUrl,
      status: "completed",
    });

    const fileSizeMb = (mp4Buffer.length / 1024 / 1024).toFixed(1);
    console.log(`[VideoJob] MP4 uploaded (${fileSizeMb} MB) for order ${orderId}`);

    // Notify owner of success
    await notifyOwner({
      title: `✅ Storybook Video Ready: Order #${orderId}`,
      content: `MP4 storybook video for ${order.childName || "a child"} (Order #${orderId}) has been successfully generated with ${completedScenes.length} scenes (${fileSizeMb} MB). Theme: ${order.storyTheme}.`,
    });

    console.log(`[VideoJob] Video generation complete for order ${orderId}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[VideoJob] Failed for order ${orderId}:`, err);
    await updateOrder(orderId, { errorMessage });

    // Notify owner of failure
    await notifyOwner({
      title: `❌ Video Generation Failed: Order #${orderId}`,
      content: `MP4 video generation failed for Order #${orderId} (${order.childName || "unknown"}). Error: ${errorMessage}`,
    });

    throw err;
  } finally {
    // Clean up temp MP4 file
    try { if (fs.existsSync(tmpMp4)) fs.unlinkSync(tmpMp4); } catch {}
  }
}

import { getOrderById } from "../db";
import { getDb } from "../db";
import { storyScenes, orders } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { splitStoryIntoScenes } from "../services/sceneSplitter";
import { generateImage } from "../_core/imageGeneration";
import { generateNarration, cloneVoiceWithElevenLabs } from "../services/ttsService";
import { nanoid } from "nanoid";
import { storagePut, storagePublicUrl } from "../storage";
import { applyBrandWatermark } from "../services/watermark";
import { getStorageNamespace } from "../services/storageNamespace";
import { notifyOwner } from "../_core/notification";
import { composeStorybookVideo } from "../services/videoComposition";


/**
 * Extract a detailed canonical character description from the generated Pixar image.
 * This description is then embedded in every scene prompt for maximum consistency.
 */
async function extractCharacterDescription(
  characterImageUrl: string,
  childName: string,
  childDescription?: string | null
): Promise<string> {
  try {
    const { invokeLLM } = await import("../_core/llm");
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a character design analyst. Given an image of a 3D Pixar/Disney animated character, produce a precise, reusable character description that can be copy-pasted into every scene illustration prompt to ensure perfect visual consistency.

Your description MUST include ALL of the following in this exact order:
1. Gender and approximate age
2. Hair: color, length, style, texture (e.g., "shoulder-length wavy auburn hair with side-swept bangs")
3. Eyes: color, shape, size (e.g., "large round bright green eyes")
4. Skin tone (e.g., "warm light olive skin")
5. Face shape and distinguishing features (e.g., "round face with a small button nose and freckles across the cheeks")
6. Body build and height (e.g., "small and slender build, about 4 feet tall")
7. Clothing: exact outfit with colors and details (e.g., "wearing a red zip-up hoodie over a white t-shirt with blue jeans and white sneakers")

Write it as a single dense paragraph. Do NOT include scene actions, expressions, or backgrounds. Only describe the character's fixed physical appearance and outfit.`,
        },
        {
          role: "user",
          content: [
            {
              type: "text" as const,
              text: `Describe this 3D Pixar/Disney animated character named ${childName} in precise detail for reuse in illustration prompts.${childDescription ? ` Known details: ${childDescription}` : ""}`,
            },
            {
              type: "image_url" as const,
              image_url: {
                url: characterImageUrl,
                detail: "high" as const,
              },
            },
          ],
        },
      ],
    });

    const description = response.choices[0]?.message?.content;
    if (description && typeof description === "string" && description.length > 50) {
      console.log(`[VideoJob] Extracted character description (${description.length} chars)`);
      return description.trim();
    }
  } catch (err) {
    console.warn(`[VideoJob] Failed to extract character description:`, err);
  }

  // Fallback: use the child description if available
  return childDescription
    ? `A 3D Pixar/Disney animated child character named ${childName}, ${childDescription}`
    : `A 3D Pixar/Disney animated child character named ${childName}`;
}

/**
 * Schedule video generation for an order.
 * This is triggered after payment is confirmed and the high-res image is generated.
 */
// In-memory lock to prevent duplicate concurrent video generation for the same order
const activeVideoJobs = new Set<number>();

export function isVideoGenerating(orderId: number): boolean {
  return activeVideoJobs.has(orderId);
}

export function scheduleVideoGeneration(orderId: number) {
  if (activeVideoJobs.has(orderId)) {
    console.log(`[VideoJob] Video generation already in progress for order ${orderId}, skipping duplicate`);
    return;
  }
  activeVideoJobs.add(orderId);
  setTimeout(() => {
    processVideoGeneration(orderId)
      .catch(async (error) => {
        console.error(`[VideoJob] Failed for order ${orderId}:`, error);
        const errMsg = error instanceof Error ? error.message : String(error);
        // Store the error message on the order so the UI can display it
        try {
          const db = await getDb();
          if (db) {
            await db.update(orders)
              .set({ errorMessage: `Video generation failed: ${errMsg.substring(0, 500)}` })
              .where(eq(orders.id, orderId));
            console.log(`[VideoJob] Stored error message on order ${orderId}`);
          }
        } catch (dbErr) {
          console.error(`[VideoJob] Failed to store error on order:`, dbErr);
        }
        // Notify owner about the failure
        try {
          await notifyOwner({
            title: `⚠️ KidzRstarz: Video Generation Failed - Order #${orderId}`,
            content: `Video generation failed for order #${orderId}.\n\nError: ${errMsg.substring(0, 400)}\n\nAction needed: Go to the Admin panel → find order #${orderId} → click Retry to regenerate the video.`,
          });
          console.log(`[VideoJob] Owner notified about video failure for order ${orderId}`);
        } catch (notifyErr) {
          console.warn(`[VideoJob] Failed to send failure notification:`, notifyErr);
        }
      })
      .finally(() => {
        activeVideoJobs.delete(orderId);
      });
  }, 2000);
}

/**
 * Main video generation pipeline:
 * 1. Clone voice with ElevenLabs if voice sample exists (done ONCE, cached on order)
 * 2. Extract canonical character description from the Pixar image
 * 3. Split story into scenes using LLM (with canonical description)
 * 4. Generate illustration for each scene (canonical description + scene prompt + reference image)
 * 5. Generate TTS narration for each scene (using cloned voice or ElevenLabs default)
 * 6. Compose full video from all scenes
 */
async function processVideoGeneration(orderId: number) {
  console.log(`[VideoJob] Starting video generation for order ${orderId}`);

  const order = await getOrderById(orderId);
  if (!order) {
    console.error(`[VideoJob] Order ${orderId} not found`);
    return;
  }

  if (!order.story) {
    console.error(`[VideoJob] Order ${orderId} has no story`);
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error(`[VideoJob] Database not available`);
    return;
  }

  try {
    // ─── Step 0: Clone voice if voice sample exists and not yet cloned ────
    let elevenlabsVoiceId = order.elevenlabsVoiceId || null;

    if (order.voiceSampleUrl && !elevenlabsVoiceId) {
      console.log(`[VideoJob] Voice sample found, cloning with ElevenLabs...`);
      const clonedId = await cloneVoiceWithElevenLabs(
        order.voiceSampleUrl,
        order.childName || "Child"
      );

      if (clonedId) {
        elevenlabsVoiceId = clonedId;
        // Save the cloned voice ID on the order for reuse
        await db
          .update(orders)
          .set({ elevenlabsVoiceId: clonedId })
          .where(eq(orders.id, orderId));
        console.log(`[VideoJob] Voice cloned and saved: ${clonedId}`);
      } else {
        console.warn(`[VideoJob] Voice cloning failed, will use default ElevenLabs or Edge TTS`);
      }
    }

    // ─── Check for existing scenes ────────────────────────────────────────
    const existingScenes = await db
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId));

    if (existingScenes.length > 0) {
      console.log(`[VideoJob] Scenes already exist for order ${orderId}, checking for pending`);
      const pendingScenes = existingScenes.filter((s) => s.status !== "completed");
      if (pendingScenes.length === 0 && order.videoUrl) {
        console.log(`[VideoJob] All scenes already completed and video exists for order ${orderId}`);
        // Ensure order is marked as completed if it isn't already
        if (order.status !== "completed") {
          const db2 = await getDb();
          if (db2) {
            await db2.update(orders)
              .set({ status: "completed", completedAt: new Date() })
              .where(eq(orders.id, orderId));
            console.log(`[VideoJob] Order ${orderId} backfilled to completed status`);
          }
        }
        return;
      }

      // Extract canonical description for pending scene processing
      const characterImageUrl = order.generatedImageUrl || order.originalImageUrl;
      let canonicalDescription = "";
      if (characterImageUrl) {
        canonicalDescription = await extractCharacterDescription(
          characterImageUrl,
          order.childName || "the child",
          order.childDescription
        );
      }

      // Process any pending scenes first
      for (const scene of pendingScenes) {
        await processScene(
          scene.id,
          orderId,
          order.userId,
          characterImageUrl,
          elevenlabsVoiceId,
          canonicalDescription
        );
      }
      // If all scenes are done but no video was composed, compose it now
      if (!order.videoUrl) {
        console.log(`[VideoJob] All scenes completed but no video exists, composing now...`);
        await composeFullVideo(orderId, order.userId, order.storyTheme);
        console.log(`[VideoJob] Video composition completed for order ${orderId}`);
      }
      return;
    }

    // ─── Step 0.5: Extract canonical character description from Pixar image ──
    const characterImageUrl = order.generatedImageUrl || order.originalImageUrl;
    let canonicalDescription = "";
    if (characterImageUrl) {
      console.log(`[VideoJob] Extracting canonical character description...`);
      canonicalDescription = await extractCharacterDescription(
        characterImageUrl,
        order.childName || "the child",
        order.childDescription
      );
      console.log(`[VideoJob] Canonical description: ${canonicalDescription.substring(0, 100)}...`);
    }

    // ─── Step 1: Split story into scenes (pass canonical description) ────
    console.log(`[VideoJob] Splitting story into scenes...`);
    const scenes = await splitStoryIntoScenes(
      order.story,
      order.childName || "the child",
      order.childDescription,
      canonicalDescription // Pass canonical description so LLM focuses on scene-specific content
    );

    // ─── Step 2: Insert scene records ─────────────────────────────────────
    for (const scene of scenes) {
      await db.insert(storyScenes).values({
        orderId,
        sceneIndex: scene.sceneIndex,
        sceneText: scene.sceneText,
        illustrationPrompt: scene.illustrationPrompt,
        status: "pending",
      });
    }

    // ─── Step 3: Process each scene (generate image + audio) ──────────────
    const insertedScenes = await db
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId));

    for (const scene of insertedScenes) {
      await processScene(
        scene.id,
        orderId,
        order.userId,
        characterImageUrl,
        elevenlabsVoiceId,
        canonicalDescription
      );
    }

    console.log(`[VideoJob] All scenes completed for order ${orderId}`);

    // ─── Step 4: Compose full video from scenes ──────────────────────
    // Let composition errors propagate so the outer catch stores errorMessage
    // Scenes are still viewable in the player even if video composition fails
    await composeFullVideo(orderId, order.userId, order.storyTheme);

    console.log(`[VideoJob] Video generation completed for order ${orderId}`);

    // ─── Send storybook ready email notification ──────────────────────
    try {
      await sendStorybookReadyNotification(orderId, order);
    } catch (notifyError) {
      console.warn(`[VideoJob] Failed to send storybook ready notification:`, notifyError);
    }
  } catch (error) {
    console.error(`[VideoJob] Error processing order ${orderId}:`, error);
    // Re-throw so scheduleVideoGeneration's outer catch stores errorMessage on the order
    throw error;
  }
}

/**
 * Compose the full storybook video from all completed scenes.
 * Downloads scene images + narration, mixes with BGM, uploads to S3.
 */
async function composeFullVideo(orderId: number, userId: number | null, storyTheme: string) {
  const db = await getDb();
  if (!db) return;

  console.log(`[VideoJob] Starting full video composition for order ${orderId}`);

  // Get all completed scenes
  const allScenes = await db
    .select()
    .from(storyScenes)
    .where(eq(storyScenes.orderId, orderId));

  // Deduplicate by sceneIndex (keep latest per index, i.e. highest id)
  const sceneMap = new Map<number, typeof allScenes[0]>();
  for (const s of allScenes) {
    if (s.status === "completed" && s.illustrationUrl) {
      const existing = sceneMap.get(s.sceneIndex);
      if (!existing || s.id > existing.id) {
        sceneMap.set(s.sceneIndex, s);
      }
    }
  }
  const completedScenes = Array.from(sceneMap.values())
    .sort((a, b) => a.sceneIndex - b.sceneIndex);

  if (completedScenes.length === 0) {
    console.warn(`[VideoJob] No completed scenes for video composition`);
    return;
  }

  // Always reconstruct fresh public URLs from the S3 keys rather than using the
  // stored illustrationUrl/narrationUrl, which may be expired pre-signed URLs
  // (pre-signed URLs expire after 1 hour; public URLs never expire).
  const sceneAssets = completedScenes.map((s) => ({
    sceneIndex: s.sceneIndex,
    illustrationUrl: s.illustrationKey
      ? storagePublicUrl(s.illustrationKey)
      : s.illustrationUrl!, // fallback to stored URL if no key (shouldn't happen)
    narrationUrl: s.narrationKey
      ? storagePublicUrl(s.narrationKey)
      : (s.narrationUrl || null), // fallback to stored URL if no key
  }));

  // Compose the video
  const videoBuffer = await composeStorybookVideo(sceneAssets, storyTheme);

  // Upload to S3
  const ns = getStorageNamespace(userId, orderId);
  const videoKey = `${ns}/videos/${nanoid()}-storybook.mp4`;
  const { url: videoUrl } = await storagePut(videoKey, videoBuffer, "video/mp4");

  // Update order with video URL, mark as completed, and clear any previous error message
  await db
    .update(orders)
    .set({
      videoKey,
      videoUrl,
      errorMessage: null,
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  console.log(`[VideoJob] Full video uploaded and order marked completed: ${videoUrl}`);
}

/**
 * Send storybook ready notification to the project owner.
 */
async function sendStorybookReadyNotification(
  orderId: number,
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>
) {
  const childName = order.childName || "A child";

  // Notify the project owner that a storybook is complete
  try {
    await notifyOwner({
      title: `KidzRstarz: Storybook Complete - ${childName}`,
      content: order.userId
        ? `Order #${orderId} - ${childName}'s storybook has been fully generated and is ready to view.`
        : `Guest order #${orderId} - ${childName}'s storybook has been fully generated.`,
    });
    console.log(`[VideoJob] Owner notified about storybook completion for order ${orderId}`);
  } catch (notifyError) {
    console.warn(`[VideoJob] Failed to notify owner for order ${orderId}:`, notifyError);
  }
}

async function processScene(
  sceneId: number,
  orderId: number,
  userId: number | null,
  characterImageUrl: string,
  elevenlabsVoiceId?: string | null,
  canonicalDescription?: string
) {
  const db = await getDb();
  if (!db) return;

  const sceneRows = await db
    .select()
    .from(storyScenes)
    .where(eq(storyScenes.id, sceneId));

  const scene = sceneRows[0];
  if (!scene) return;
  if (scene.status === "completed") return;

  try {
    // ─── Generate illustration with character consistency ─────────────────
    console.log(`[VideoJob] Generating illustration for scene ${scene.sceneIndex}...`);
    await db
      .update(storyScenes)
      .set({ status: "generating_image" })
      .where(eq(storyScenes.id, sceneId));

    // Build the full prompt: canonical character description FIRST, then scene-specific content
    // The canonical description is the single source of truth for the character's appearance
    const characterBlock = canonicalDescription
      ? `EXACT CHARACTER TO USE IN THIS SCENE (do NOT change any detail):\n${canonicalDescription}\n\n`
      : "";

    const imageResult = await generateImage({
      prompt: `${characterBlock}SCENE ILLUSTRATION:\n${scene.illustrationPrompt}

CRITICAL RULES:
1. The character in this scene MUST match the reference image EXACTLY — same face, hair, eyes, skin, clothing, proportions.
2. Only change the character's pose, expression, and the background/setting.
3. Style: High-quality 3D Pixar/Disney animation, children's storybook illustration, cinematic lighting, vibrant saturated colors, movie-quality render.
4. Do NOT add, remove, or change any clothing items or accessories from the character description above.`,
      originalImages: [
        {
          url: characterImageUrl,
          mimeType: "image/png",
        },
      ],
    });

    if (imageResult.url) {
      // Download, watermark, and re-upload the scene illustration
      let finalIllustrationUrl = imageResult.url;
      const ns = getStorageNamespace(userId, orderId);
      const sceneFileKey = `${ns}/scenes/${nanoid()}-scene-${scene.sceneIndex}.png`;
      try {
        const imgResponse = await fetch(imageResult.url);
        if (imgResponse.ok) {
          const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
          const brandedBuffer = await applyBrandWatermark(imgBuffer);
          const { url: s3Url } = await storagePut(sceneFileKey, brandedBuffer, "image/png");
          finalIllustrationUrl = s3Url;
        }
      } catch (wmError) {
        console.warn(`[VideoJob] Watermark failed for scene ${scene.sceneIndex}, using original:`, wmError);
      }

      await db
        .update(storyScenes)
        .set({
          illustrationUrl: finalIllustrationUrl,
          illustrationKey: sceneFileKey,
        })
        .where(eq(storyScenes.id, sceneId));
    }

    // ─── Generate TTS narration ──────────────────────────────────────────
    console.log(`[VideoJob] Generating narration for scene ${scene.sceneIndex}...`);
    await db
      .update(storyScenes)
      .set({ status: "generating_audio" })
      .where(eq(storyScenes.id, sceneId));

    try {
      const audioResult = await generateNarration(scene.sceneText, userId, orderId, {
        elevenlabsVoiceId: elevenlabsVoiceId || undefined,
      });
      await db
        .update(storyScenes)
        .set({
          narrationUrl: audioResult.audioUrl,
          narrationKey: audioResult.audioKey,
          status: "completed",
        })
        .where(eq(storyScenes.id, sceneId));
      console.log(`[VideoJob] Scene ${scene.sceneIndex} completed with narration`);
    } catch (ttsError) {
      // TTS failed - mark scene as completed anyway (illustration is the key asset)
      console.warn(
        `[VideoJob] TTS failed for scene ${scene.sceneIndex}, marking as completed without audio:`,
        ttsError instanceof Error ? ttsError.message : ttsError
      );
      await db
        .update(storyScenes)
        .set({ status: "completed" })
        .where(eq(storyScenes.id, sceneId));
    }
  } catch (error) {
    console.error(`[VideoJob] Error processing scene ${sceneId}:`, error);
    await db
      .update(storyScenes)
      .set({ status: "failed" })
      .where(eq(storyScenes.id, sceneId));
    // Notify owner about scene failure
    try {
      const errMsg = error instanceof Error ? error.message : String(error);
      await notifyOwner({
        title: `⚠️ KidzRstarz: Scene Generation Failed - Order #${orderId}`,
        content: `Scene ${sceneId} (order #${orderId}) failed to generate.\n\nError: ${errMsg.substring(0, 400)}\n\nThe video generation will continue with remaining scenes, but this scene may be missing.`,
      });
    } catch (notifyErr) {
      console.warn(`[VideoJob] Failed to send scene failure notification:`, notifyErr);
    }
  }
}

import { getOrderById } from "../db";
import { getDb } from "../db";
import { storyScenes, orders } from "../../drizzle/schema";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { splitStoryIntoScenes } from "../services/sceneSplitter";
import { generateImage } from "../_core/imageGeneration";
import { generateNarration, cloneVoiceWithElevenLabs } from "../services/ttsService";
import { nanoid } from "nanoid";
import { storagePut, storageReadBytes } from "../storage";
import { applyBrandWatermark } from "../services/watermark";
import { getStorageNamespace } from "../services/storageNamespace";
import { notifyOwner } from "../_core/notification";
import { composeStorybookVideo } from "../services/videoComposition";

type CharacterReference = {
  storageKey: string | null;
  legacyUrl: string | null;
};

type SceneRow = {
  id: number;
  sceneIndex: number;
  sceneText: string;
  illustrationPrompt: string | null;
  illustrationKey: string | null;
  illustrationUrl: string | null;
  narrationKey: string | null;
  narrationUrl: string | null;
  status: string;
};

type ProcessVideoGenerationOptions = {
  /**
   * A retry is an explicit operator action. Payment callbacks and ordinary
   * scheduling must not silently recreate failed or missing paid scene assets.
   */
  retryMissingScenes?: boolean;
};

/**
 * Extract a detailed canonical character description from the generated animated character image.
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
          content: `You are a character design analyst. Given an image of a 3D animated character, produce a precise, reusable character description that can be copy-pasted into every scene illustration prompt to ensure perfect visual consistency.

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
              text: `Describe this 3D animated character named ${childName} in precise detail for reuse in illustration prompts.${childDescription ? ` Known details: ${childDescription}` : ""}`,
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
    ? `A premium 3D animated child character named ${childName}, ${childDescription}`
    : `A premium 3D animated child character named ${childName}`;
}

/**
 * A stored key is authoritative. It is deliberately not paired with a fallback
 * to the legacy URL: an access failure must not accidentally send a private
 * customer asset through an unsigned URL path.
 */
async function characterReferenceForLLM(reference: CharacterReference): Promise<string> {
  if (reference.storageKey) {
    const stored = await storageReadBytes(reference.storageKey);
    const mimeType = stored.contentType || "image/png";
    return `data:${mimeType};base64,${stored.data.toString("base64")}`;
  }

  if (reference.legacyUrl) {
    return reference.legacyUrl;
  }

  throw new Error("Order has no generated or original character image reference");
}

/**
 * The paid generated image is preferred, followed by the source original. A
 * legacy URL is retained only for pre-key records and is never used if either
 * canonical key exists.
 */
function getCharacterReference(order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>): CharacterReference {
  if (order.generatedImageKey) {
    return {
      storageKey: order.generatedImageKey,
      legacyUrl: order.generatedImageUrl,
    };
  }

  if (order.originalImageKey) {
    return {
      storageKey: order.originalImageKey,
      legacyUrl: order.originalImageUrl,
    };
  }

  return {
    storageKey: null,
    legacyUrl: order.generatedImageUrl || order.originalImageUrl || null,
  };
}

function hasRenderableIllustration(scene: Pick<SceneRow, "status" | "illustrationKey" | "illustrationUrl">): boolean {
  return scene.status === "completed" && Boolean(scene.illustrationKey || scene.illustrationUrl);
}

function summarizeScenes(scenes: SceneRow[]) {
  const byIndex = new Map<number, SceneRow[]>();
  for (const scene of scenes) {
    const group = byIndex.get(scene.sceneIndex) || [];
    group.push(scene);
    byIndex.set(scene.sceneIndex, group);
  }

  const completedByIndex = new Map<number, SceneRow>();
  const missingSceneIndexes: number[] = [];

  for (const [sceneIndex, group] of Array.from(byIndex.entries())) {
    const completed = group
      .filter(hasRenderableIllustration)
      .sort((a: SceneRow, b: SceneRow) => b.id - a.id)[0];

    if (completed) {
      completedByIndex.set(sceneIndex, completed);
    } else {
      missingSceneIndexes.push(sceneIndex);
    }
  }

  return {
    completedScenes: Array.from(completedByIndex.values()).sort((a, b) => a.sceneIndex - b.sceneIndex),
    missingSceneIndexes: missingSceneIndexes.sort((a, b) => a - b),
    byIndex,
  };
}

function chooseRetryScene(group: SceneRow[]): SceneRow {
  // There is no complete illustration for this index. Prefer the newest
  // incomplete row; a completed-but-corrupt row is retried only when it is the
  // sole recoverable representation for the scene.
  return [...group]
    .filter((scene) => scene.status !== "completed")
    .sort((a, b) => b.id - a.id)[0]
    || [...group].sort((a, b) => b.id - a.id)[0];
}

function hasCanonicalVideo(order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>): boolean {
  // videoUrl may be an old public/expired URL. A paid workflow is complete only
  // when a canonical permanent video key exists.
  return Boolean(order.videoKey);
}

const VIDEO_CLAIM_STALE_MS = 30 * 60 * 1000;

/**
 * Claim paid video work across processes. The in-memory set below avoids local
 * duplicates, while this compare-and-set prevents two Railway instances from
 * producing voice, illustrations, or video for the same order at once.
 */
async function claimVideoGeneration(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>
): Promise<boolean> {
  if (!order.generatedImageKey || order.videoKey) return false;

  const staleBefore = new Date(Date.now() - VIDEO_CLAIM_STALE_MS);
  const result = await db
    .update(orders)
    .set({ status: "processing" })
    .where(and(
      eq(orders.id, order.id),
      eq(orders.paymentStatus, "paid"),
      eq(orders.storyApproved, true),
      eq(orders.generatedImageKey, order.generatedImageKey),
      isNull(orders.videoKey),
      or(
        eq(orders.status, "completed"),
        eq(orders.status, "pending"),
        eq(orders.status, "failed"),
        and(eq(orders.status, "processing"), lt(orders.updatedAt, staleBefore))
      )
    ));

  // mysql2's ResultSetHeader exposes affectedRows. Do not assume success when
  // it is missing: that would defeat the cross-instance lock.
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: unknown })?.affectedRows || 0) === 1;
}

async function renewVideoClaim(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, orderId: number) {
  // Scene progress must renew the existing updatedAt lease, not allow another
  // instance to claim a legitimate long-running storybook render.
  await db.update(orders).set({ status: "processing" }).where(and(
    eq(orders.id, orderId), eq(orders.paymentStatus, "paid"),
    eq(orders.storyApproved, true), eq(orders.status, "processing"), isNull(orders.videoKey)
  ));
}

async function releaseVideoClaimAsFailed(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  orderId: number
): Promise<void> {
  try {
    await db
      .update(orders)
      .set({ status: "failed" })
      .where(and(eq(orders.id, orderId), eq(orders.status, "processing")));
  } catch (releaseError) {
    console.error(`[VideoJob] Failed to release video claim for order ${orderId}:`, releaseError);
  }
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

/**
 * Set retryMissingScenes only from an explicit admin/user retry action. Normal
 * payment callbacks retain the default and will not regenerate paid scene work.
 */
export function scheduleVideoGeneration(orderId: number, options: ProcessVideoGenerationOptions = {}) {
  if (activeVideoJobs.has(orderId)) {
    console.log(`[VideoJob] Video generation already in progress for order ${orderId}, skipping duplicate`);
    return;
  }
  activeVideoJobs.add(orderId);
  setTimeout(() => {
    processVideoGeneration(orderId, options)
      .catch(async (error) => {
        console.error(`[VideoJob] Failed for order ${orderId}:`, error);
        const errMsg = error instanceof Error ? error.message : String(error);
        // Store the error message on the order so the UI can display it
        try {
          const db = await getDb();
          if (db) {
            await db.update(orders)
              .set({ errorMessage: "Video: generation failed. Please try again." })
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

async function cloneVoiceIfNeeded(
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
  orderId: number,
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>
): Promise<string | null> {
  let elevenlabsVoiceId = order.elevenlabsVoiceId || null;
  if ((order.voiceSampleKey || order.voiceSampleUrl) && !elevenlabsVoiceId) {
    console.log(`[VideoJob] Voice sample found, cloning with ElevenLabs...`);
    const clonedId = await cloneVoiceWithElevenLabs(
      order.voiceSampleUrl || "",
      order.childName || "Child",
      order.voiceSampleKey || undefined
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

  return elevenlabsVoiceId;
}

async function markCompletedIfNeeded(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  order: NonNullable<Awaited<ReturnType<typeof getOrderById>>>,
  orderId: number
): Promise<void> {
  if (order.status === "completed") return;

  await db.update(orders)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(orders.id, orderId));
  console.log(`[VideoJob] Order ${orderId} backfilled to completed status`);
}

/**
 * Main video generation pipeline:
 * 1. Clone voice with ElevenLabs if voice sample exists (done ONCE, cached on order)
 * 2. Extract canonical character description from the generated character image
 * 3. Split story into scenes using LLM (with canonical description)
 * 4. Generate illustration for each scene (canonical description + scene prompt + reference image)
 * 5. Generate TTS narration for each scene (using cloned voice or ElevenLabs default)
 * 6. Compose full video from all scenes
 */
export async function processVideoGeneration(
  orderId: number,
  options: ProcessVideoGenerationOptions = {}
): Promise<void> {
  console.log(`[VideoJob] Starting video generation for order ${orderId}`);

  const order = await getOrderById(orderId);
  if (!order) {
    console.error(`[VideoJob] Order ${orderId} not found`);
    return;
  }

  // These checks intentionally precede every provider/storage generation call.
  // A browser callback or stale queue item must never create paid media before
  // payment and story approval are both final.
  if (order.paymentStatus !== "paid") {
    console.warn(`[VideoJob] Order ${orderId} is not paid; skipping video generation`);
    return;
  }

  if (!order.storyApproved) {
    console.warn(`[VideoJob] Order ${orderId} story is not approved; skipping video generation`);
    return;
  }

  if (!order.story) {
    console.error(`[VideoJob] Order ${orderId} has no story`);
    return;
  }

  // A finished canonical video is reusable. Do not claim or regenerate it.
  if (hasCanonicalVideo(order)) {
    const readyDb = await getDb();
    if (readyDb) await markCompletedIfNeeded(readyDb, order, orderId);
    console.log(`[VideoJob] Canonical video already exists for order ${orderId}, skipping generation`);
    return;
  }

  // Paid video is based on the paid high-resolution character, not a URL-only
  // preview. The compare-and-set below also requires this key.
  const characterReference = getCharacterReference(order);
  if (!order.generatedImageKey || !characterReference.storageKey) {
    console.warn(`[VideoJob] Order ${orderId} has no canonical paid character image; skipping video generation`);
    return;
  }

  const db = await getDb();
  if (!db) {
    console.error(`[VideoJob] Database not available`);
    return;
  }

  const claimed = await claimVideoGeneration(db, order);
  if (!claimed) {
    console.log(`[VideoJob] Order ${orderId} has an active/fresh video claim or is no longer eligible, skipping duplicate`);
    return;
  }

  try {
    // ─── Check existing scenes before starting any provider work ────────────
    const existingScenes = await db
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId)) as SceneRow[];

    if (existingScenes.length > 0) {
      const sceneState = summarizeScenes(existingScenes);

      if (sceneState.missingSceneIndexes.length === 0) {
        if (hasCanonicalVideo(order)) {
          console.log(`[VideoJob] All scenes and a canonical video key already exist for order ${orderId}`);
          await markCompletedIfNeeded(db, order, orderId);
          return;
        }

        // Every scene is intact, but a legacy URL-only or missing video needs a
        // new canonical-key composition. No image, LLM, or voice generation is
        // necessary for this recovery path.
        console.log(`[VideoJob] All scenes completed but no canonical video key exists; composing now...`);
        await composeFullVideo(orderId, order.userId, order.storyTheme);
        console.log(`[VideoJob] Video composition completed for order ${orderId}`);
        return;
      }

      if (!options.retryMissingScenes) {
        console.warn(
          `[VideoJob] Order ${orderId} has missing/failed scenes (${sceneState.missingSceneIndexes.join(", ")}); ` +
          "leaving completed assets untouched until an explicit retry"
        );
        await releaseVideoClaimAsFailed(db, orderId);
        await db.update(orders).set({ errorMessage: "Video: Some scenes could not be completed. Please retry the missing scenes." }).where(and(eq(orders.id, orderId), eq(orders.status, "failed")));
        return;
      }

      // Explicit retry only: process a single missing representation for each
      // missing scene index. Completed scene assets are never regenerated.
      const elevenlabsVoiceId = await cloneVoiceIfNeeded(order, orderId, db);
      const llmImageInput = await characterReferenceForLLM(characterReference);
      const canonicalDescription = await extractCharacterDescription(
        llmImageInput,
        order.childName || "the child",
        order.childDescription
      );

      for (const sceneIndex of sceneState.missingSceneIndexes) {
        await renewVideoClaim(db, orderId);
        const scene = chooseRetryScene(sceneState.byIndex.get(sceneIndex) || []);
        if (!scene) continue;
        await processScene(
          scene.id,
          orderId,
          order.userId,
          characterReference,
          elevenlabsVoiceId,
          canonicalDescription,
          true
        );
      }

      const refreshedScenes = await db
        .select()
        .from(storyScenes)
        .where(eq(storyScenes.orderId, orderId)) as SceneRow[];
      const refreshedState = summarizeScenes(refreshedScenes);
      if (refreshedState.missingSceneIndexes.length > 0) {
        throw new Error(
          `Cannot compose storybook: scenes ${refreshedState.missingSceneIndexes.join(", ")} are incomplete or missing illustrations`
        );
      }

      if (!hasCanonicalVideo(order)) {
        await composeFullVideo(orderId, order.userId, order.storyTheme);
      }
      return;
    }

    // ─── Step 0: Clone voice if voice sample exists and not yet cloned ──────
    const elevenlabsVoiceId = await cloneVoiceIfNeeded(order, orderId, db);

    // ─── Step 0.5: Read the canonical character key for the LLM ────────────
    const llmImageInput = await characterReferenceForLLM(characterReference);
    console.log(`[VideoJob] Extracting canonical character description...`);
    const canonicalDescription = await extractCharacterDescription(
      llmImageInput,
      order.childName || "the child",
      order.childDescription
    );
    console.log(`[VideoJob] Canonical description: ${canonicalDescription.substring(0, 100)}...`);

    // ─── Step 1: Split story into scenes (pass canonical description) ──────
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

    // ─── Step 3: Process each newly created scene ─────────────────────────
    const insertedScenes = await db
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId)) as SceneRow[];

    for (const scene of insertedScenes) {
      await renewVideoClaim(db, orderId);
      await processScene(
        scene.id,
        orderId,
        order.userId,
        characterReference,
        elevenlabsVoiceId,
        canonicalDescription
      );
    }

    const completedScenes = await db
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId)) as SceneRow[];
    const completedState = summarizeScenes(completedScenes);
    if (completedState.missingSceneIndexes.length > 0) {
      throw new Error(
        `Cannot compose storybook: scenes ${completedState.missingSceneIndexes.join(", ")} are incomplete or missing illustrations`
      );
    }

    console.log(`[VideoJob] All scenes completed for order ${orderId}`);

    // ─── Step 4: Compose full video from scenes ────────────────────────────
    // Let composition errors propagate so the outer catch stores errorMessage.
    // Scenes are still viewable in the player even if video composition fails.
    await composeFullVideo(orderId, order.userId, order.storyTheme);

    console.log(`[VideoJob] Video generation completed for order ${orderId}`);

    // ─── Send storybook ready email notification ───────────────────────────
    try {
      await sendStorybookReadyNotification(orderId, order);
    } catch (notifyError) {
      console.warn(`[VideoJob] Failed to send storybook ready notification:`, notifyError);
    }
  } catch (error) {
    console.error(`[VideoJob] Error processing order ${orderId}:`, error);
    await releaseVideoClaimAsFailed(db, orderId);
    // Re-throw so scheduleVideoGeneration's outer catch stores errorMessage.
    throw error;
  }
}

/**
 * Compose the full storybook video from all completed scenes.
 * Downloads scene images + narration, mixes with BGM, uploads to S3.
 */
async function composeFullVideo(orderId: number, userId: number | null, storyTheme: string) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available for video composition");
  }

  await renewVideoClaim(db, orderId);
  console.log(`[VideoJob] Starting full video composition for order ${orderId}`);

  const allScenes = await db
    .select()
    .from(storyScenes)
    .where(eq(storyScenes.orderId, orderId)) as SceneRow[];
  const sceneState = summarizeScenes(allScenes);

  // Never make a video from only the successful subset. A scene index without a
  // completed illustration is a failed/missing paid scene, not a finished story.
  if (sceneState.missingSceneIndexes.length > 0) {
    throw new Error(
      `Cannot compose storybook: scenes ${sceneState.missingSceneIndexes.join(", ")} are incomplete or missing illustrations`
    );
  }

  if (sceneState.completedScenes.length === 0) {
    throw new Error("Cannot compose storybook: no completed scenes are available");
  }

  const sceneAssets = sceneState.completedScenes.map((scene) => ({
    sceneIndex: scene.sceneIndex,
    // The composer reads keys through the authenticated SDK. URL fields are
    // retained only as metadata/fallback for legacy records that have no key.
    illustrationKey: scene.illustrationKey,
    illustrationUrl: scene.illustrationUrl,
    narrationKey: scene.narrationKey,
    narrationUrl: scene.narrationUrl,
  }));

  const videoBuffer = await composeStorybookVideo(sceneAssets, storyTheme);
  if (videoBuffer.length === 0) {
    throw new Error("Video composition returned an empty MP4");
  }

  // Upload to S3 and persist the key returned by storage, never a locally
  // assumed destination key.
  const ns = getStorageNamespace(userId, orderId);
  const requestedVideoKey = `${ns}/videos/${nanoid()}-storybook-h264420.mp4`;
  const uploadedVideo = await storagePut(requestedVideoKey, videoBuffer, "video/mp4");
  if (!uploadedVideo.key) {
    throw new Error("Video upload completed without a canonical storage key");
  }

  // Update order with video URL metadata, a permanent key, and completion state.
  await db
    .update(orders)
    .set({
      videoKey: uploadedVideo.key,
      videoUrl: uploadedVideo.url,
      errorMessage: null,
      status: "completed",
      completedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  console.log(`[VideoJob] Full video uploaded and order marked completed: ${uploadedVideo.url}`);
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

async function readLegacyImageResult(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated scene image: ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function processScene(
  sceneId: number,
  orderId: number,
  userId: number | null,
  characterReference: CharacterReference,
  elevenlabsVoiceId?: string | null,
  canonicalDescription?: string,
  retryMissingScene = false
) {
  const db = await getDb();
  if (!db) return;

  const sceneRows = await db
    .select()
    .from(storyScenes)
    .where(eq(storyScenes.id, sceneId)) as SceneRow[];

  const scene = sceneRows[0];
  if (!scene) return;
  if (hasRenderableIllustration(scene)) return;

  // Existing failed/generating records are retried only by an explicit caller.
  if (scene.status !== "pending" && !retryMissingScene) {
    console.warn(`[VideoJob] Scene ${scene.sceneIndex} is ${scene.status}; awaiting an explicit retry`);
    return;
  }

  try {
    // Keep a successfully stored illustration during an explicit audio/restart retry.
    if (!(scene.illustrationKey || scene.illustrationUrl)) {
    // ─── Generate illustration with character consistency ─────────────────
    console.log(`[VideoJob] Generating illustration for scene ${scene.sceneIndex}...`);
    await db
      .update(storyScenes)
      .set({ status: "generating_image" })
      .where(eq(storyScenes.id, sceneId));

    // Build the full prompt: canonical character description FIRST, then scene-specific content.
    // The canonical description is the single source of truth for the character's appearance.
    const characterBlock = canonicalDescription
      ? `EXACT CHARACTER TO USE IN THIS SCENE (do NOT change any detail):\n${canonicalDescription}\n\n`
      : "";

    const imageResult = await generateImage({
      prompt: `CONTENT POLICY: This is a completely child-safe, G-rated, family-friendly children's storybook illustration. All content is wholesome and appropriate for young children ages 2-10.

${characterBlock}SCENE ILLUSTRATION:\n${scene.illustrationPrompt}

CRITICAL RULES:
1. The character in this scene MUST match the reference image EXACTLY — same face, hair, eyes, skin, clothing, proportions.
2. Only change the character's pose, expression, and the background/setting.
3. Style: High-quality premium 3D cinematic animation, children's storybook illustration, cinematic lighting, vibrant saturated colors, movie-quality render. G-rated and family-friendly.
4. Do NOT add, remove, or change any clothing items or accessories from the character description above.
5. All content must be completely child-safe, wholesome, and appropriate for a children's picture book.
6. WIDESCREEN COMPOSITION: Frame this as a wide 16:9 cinematic landscape — like a still from a premium animated movie. The character should be positioned within a wide horizontal frame with a rich, detailed background extending to both sides. Do NOT use a portrait or square crop.`,
      originalImages: [
        characterReference.storageKey
          ? {
            storageKey: characterReference.storageKey,
            mimeType: "image/png",
          }
          : {
            // A legacy URL is allowed only when there was no canonical key.
            url: characterReference.legacyUrl || undefined,
            mimeType: "image/png",
          },
      ],
    });

    if (!imageResult.key && !imageResult.url) {
      throw new Error("Image generation returned neither a canonical key nor a legacy URL");
    }

    // A canonical provider result is read through the SDK before watermarking.
    // If this read fails, do not fall back to imageResult.url.
    const sourceImage = imageResult.key
      ? await storageReadBytes(imageResult.key)
      : { data: await readLegacyImageResult(imageResult.url!) };

    let brandedBuffer: Buffer | null = null;
    try {
      brandedBuffer = await applyBrandWatermark(sourceImage.data);
    } catch (watermarkError) {
      // The source result has already been validated above. Retain its actual
      // canonical key if watermarking itself fails; never write the unuploaded
      // requested scene key.
      if (imageResult.key) {
        console.warn(`[VideoJob] Watermark failed for scene ${scene.sceneIndex}, retaining source image key:`, watermarkError);
        await db
          .update(storyScenes)
          .set({
            illustrationUrl: imageResult.url || null,
            illustrationKey: imageResult.key,
          })
          .where(eq(storyScenes.id, sceneId));
      } else {
        console.warn(`[VideoJob] Watermark failed for legacy scene ${scene.sceneIndex}, retaining source URL:`, watermarkError);
        await db
          .update(storyScenes)
          .set({
            illustrationUrl: imageResult.url || null,
            illustrationKey: null,
          })
          .where(eq(storyScenes.id, sceneId));
      }
    }

    if (brandedBuffer) {
      const ns = getStorageNamespace(userId, orderId);
      const requestedSceneKey = `${ns}/scenes/${nanoid()}-scene-${scene.sceneIndex}.png`;
      const uploadedScene = await storagePut(requestedSceneKey, brandedBuffer, "image/png");
      if (!uploadedScene.key) {
        throw new Error("Scene upload completed without a canonical storage key");
      }

      await db
        .update(storyScenes)
        .set({
          illustrationUrl: uploadedScene.url,
          illustrationKey: uploadedScene.key,
        })
        .where(eq(storyScenes.id, sceneId));
    }

    }

    // ─── Generate TTS narration ──────────────────────────────────────────
    console.log(`[VideoJob] Generating narration for scene ${scene.sceneIndex}...`);
    await db
      .update(storyScenes)
      .set({ status: "generating_audio" })
      .where(eq(storyScenes.id, sceneId));

    if (scene.narrationKey || scene.narrationUrl) {
      await db.update(storyScenes).set({ status: "completed" }).where(eq(storyScenes.id, sceneId));
      return;
    }

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
      // TTS failed - mark scene as completed anyway (illustration is the key asset).
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
        content: `Scene ${sceneId} (order #${orderId}) failed to generate.\n\nError: ${errMsg.substring(0, 400)}\n\nCompleted scene assets are preserved. An explicit retry can regenerate only the missing parts.`,
      });
    } catch (notifyErr) {
      console.warn(`[VideoJob] Failed to send scene failure notification:`, notifyErr);
    }
  }
}

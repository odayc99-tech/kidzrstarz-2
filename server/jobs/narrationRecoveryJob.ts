import { and, eq, isNull, like, lt, notLike, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { orders, storyScenes } from "../../drizzle/schema";
import { getDb, getOrderById } from "../db";
import { storagePut } from "../storage";
import { getStorageNamespace } from "../services/storageNamespace";
import { cloneVoiceWithElevenLabs, generateNarration } from "../services/ttsService";
import { composeStorybookVideo } from "../services/videoComposition";

/**
 * The marker is deliberately stored only while this recovery owns the order.
 * It is a cross-instance lease, not a customer-facing error; callers should
 * use getNarrationRecoveryState rather than exposing this raw string.
 */
const NARRATION_RECOVERY_LEASE_PREFIX = "NarrationRecovery: lease:";
const NARRATION_RECOVERY_ERROR_PREFIX = "Narration recovery failed:";
const NARRATION_RECOVERY_STALE_MS = 30 * 60 * 1000;
const SAFE_RECOVERY_FAILURE = "Narration recovery failed: Your existing storybook is unchanged. Please try again.";
const SAFE_RECOVERY_STALE = "Narration recovery stalled: Your existing storybook is unchanged. Please try again.";
let leaseHeartbeat = 0;

type RecoveryOrder = NonNullable<Awaited<ReturnType<typeof getOrderById>>>;

type SceneRow = {
  id: number;
  orderId: number;
  sceneIndex: number;
  sceneText: string;
  illustrationPrompt: string | null;
  illustrationKey: string | null;
  illustrationUrl: string | null;
  narrationKey: string | null;
  narrationUrl: string | null;
  status: (typeof storyScenes.$inferSelect)["status"];
};

type NarrationReplacement = {
  sceneId: number;
  narrationKey: string;
  narrationUrl: string;
};

type Lease = {
  token: string;
  marker: string;
  originalVideoKey: string;
};

class LeaseLostError extends Error {
  constructor() {
    super("Narration recovery lease was lost");
  }
}

class SceneSnapshotChangedError extends Error {
  constructor() {
    super("Narration recovery scene snapshot changed");
  }
}

function leaseMarker(token: string): string {
  // Refreshing a changing marker renews updatedAt even on MySQL clients that
  // report zero affected rows for an assignment to the same value.
  leaseHeartbeat += 1;
  return `${NARRATION_RECOVERY_LEASE_PREFIX}${token}:${Date.now()}:${leaseHeartbeat}`;
}

function isLeaseMarker(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(NARRATION_RECOVERY_LEASE_PREFIX));
}

function affectedRows(result: unknown): number {
  // drizzle/mysql2 writes may be [ResultSetHeader, FieldPacket[]]. Treat an
  // absent affectedRows as failure; assuming success would defeat the CAS.
  const header = Array.isArray(result) ? result[0] : result;
  return Number((header as { affectedRows?: unknown } | undefined)?.affectedRows || 0);
}

function isEligibleForNarrationRecovery(order: RecoveryOrder | null): order is RecoveryOrder {
  return Boolean(
    order &&
    order.status === "completed" &&
    order.paymentStatus === "paid" &&
    order.storyApproved &&
    order.videoKey &&
    (order.voiceSampleKey || order.voiceSampleUrl)
  );
}

function nullableEquals(column: any, value: string | null) {
  return value === null ? isNull(column) : eq(column, value);
}

function sceneSnapshotCondition(scene: SceneRow) {
  return and(
    eq(storyScenes.id, scene.id),
    eq(storyScenes.orderId, scene.orderId),
    eq(storyScenes.sceneIndex, scene.sceneIndex),
    eq(storyScenes.sceneText, scene.sceneText),
    nullableEquals(storyScenes.illustrationPrompt, scene.illustrationPrompt),
    nullableEquals(storyScenes.illustrationKey, scene.illustrationKey),
    nullableEquals(storyScenes.illustrationUrl, scene.illustrationUrl),
    nullableEquals(storyScenes.narrationKey, scene.narrationKey),
    nullableEquals(storyScenes.narrationUrl, scene.narrationUrl),
    eq(storyScenes.status, scene.status)
  );
}

function sameSceneSnapshot(current: SceneRow, snapshot: SceneRow): boolean {
  return current.id === snapshot.id &&
    current.orderId === snapshot.orderId &&
    current.sceneIndex === snapshot.sceneIndex &&
    current.sceneText === snapshot.sceneText &&
    current.illustrationPrompt === snapshot.illustrationPrompt &&
    current.illustrationKey === snapshot.illustrationKey &&
    current.illustrationUrl === snapshot.illustrationUrl &&
    current.narrationKey === snapshot.narrationKey &&
    current.narrationUrl === snapshot.narrationUrl &&
    current.status === snapshot.status;
}

/**
 * Pick the exact canonical renderable representation per scene index. URL-only
 * illustrations are intentionally not sufficient for this repair: its input
 * must remain the paid canonical object storage snapshot.
 */
function canonicalScenesFrom(rows: SceneRow[]): SceneRow[] {
  if (rows.length === 0) {
    throw new Error("No completed canonical scenes are available for narration recovery");
  }

  const byIndex = new Map<number, SceneRow[]>();
  for (const scene of rows) {
    const group = byIndex.get(scene.sceneIndex) || [];
    group.push(scene);
    byIndex.set(scene.sceneIndex, group);
  }

  const canonical: SceneRow[] = [];
  for (const group of Array.from(byIndex.values())) {
    const selected = [...group]
      .filter((scene) => scene.status === "completed" && Boolean(scene.illustrationKey))
      .sort((a, b) => b.id - a.id)[0];

    if (!selected) {
      throw new Error("All existing scenes must have completed canonical illustrations");
    }
    if (!selected.sceneText.trim()) {
      throw new Error("A completed scene is missing narration text");
    }
    canonical.push(selected);
  }

  return canonical.sort((a, b) => a.sceneIndex - b.sceneIndex);
}

function recoveryLeaseCondition(orderId: number, originalVideoKey: string, marker: string) {
  return and(
    eq(orders.id, orderId),
    eq(orders.status, "completed"),
    eq(orders.paymentStatus, "paid"),
    eq(orders.storyApproved, true),
    eq(orders.videoKey, originalVideoKey),
    eq(orders.errorMessage, marker)
  );
}

async function claimNarrationRecovery(db: any, order: RecoveryOrder): Promise<Lease | null> {
  if (!isEligibleForNarrationRecovery(order)) return null;

  const originalVideoKey = order.videoKey;
  if (!originalVideoKey) return null;
  const token = nanoid(18);
  const marker = leaseMarker(token);
  const staleBefore = new Date(Date.now() - NARRATION_RECOVERY_STALE_MS);

  const result = await db
    .update(orders)
    .set({ errorMessage: marker })
    .where(and(
      eq(orders.id, order.id),
      eq(orders.status, "completed"),
      eq(orders.paymentStatus, "paid"),
      eq(orders.storyApproved, true),
      eq(orders.videoKey, originalVideoKey),
      // Existing non-recovery errors, including the original quota error, are
      // eligible for an explicit recovery. Only a fresh recovery lease blocks it.
      or(
        isNull(orders.errorMessage),
        notLike(orders.errorMessage, `${NARRATION_RECOVERY_LEASE_PREFIX}%`),
        and(
          like(orders.errorMessage, `${NARRATION_RECOVERY_LEASE_PREFIX}%`),
          lt(orders.updatedAt, staleBefore)
        )
      )
    ));

  if (affectedRows(result) !== 1) return null;
  return { token, marker, originalVideoKey };
}

async function renewNarrationRecoveryLease(db: any, orderId: number, lease: Lease): Promise<Lease | null> {
  const marker = leaseMarker(lease.token);
  const result = await db
    .update(orders)
    .set({ errorMessage: marker })
    .where(recoveryLeaseCondition(orderId, lease.originalVideoKey, lease.marker));

  return affectedRows(result) === 1 ? { ...lease, marker } : null;
}

async function cacheClonedVoice(db: any, orderId: number, lease: Lease, voiceId: string): Promise<boolean> {
  const result = await db
    .update(orders)
    .set({ elevenlabsVoiceId: voiceId })
    .where(and(recoveryLeaseCondition(orderId, lease.originalVideoKey, lease.marker), isNull(orders.elevenlabsVoiceId)));
  return affectedRows(result) === 1;
}

async function failNarrationRecovery(db: any, orderId: number, lease: Lease): Promise<void> {
  try {
    // Never clear or alter a lease owned by another instance. The completed
    // status, video, payment and all prior scene assets remain intact on error.
    await db
      .update(orders)
      .set({ errorMessage: SAFE_RECOVERY_FAILURE })
      .where(recoveryLeaseCondition(orderId, lease.originalVideoKey, lease.marker));
  } catch (error) {
    console.warn(`[NarrationRecovery] Could not record safe failure for order ${orderId}`);
  }
}

async function commitNarrationRecovery(
  db: any,
  orderId: number,
  lease: Lease,
  snapshots: SceneRow[],
  replacements: NarrationReplacement[],
  uploadedVideo: { key: string; url: string }
): Promise<void> {
  if (typeof db.transaction !== "function") {
    throw new Error("Narration recovery requires a database transaction");
  }

  await db.transaction(async (tx: any) => {
    const ownedOrders = await tx
      .select()
      .from(orders)
      .where(recoveryLeaseCondition(orderId, lease.originalVideoKey, lease.marker));
    if (!ownedOrders[0]) throw new LeaseLostError();

    const currentScenes = await tx
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId)) as SceneRow[];
    const currentById = new Map(currentScenes.map((scene) => [scene.id, scene]));
    if (
      snapshots.some((snapshot) => !currentById.has(snapshot.id) || !sameSceneSnapshot(currentById.get(snapshot.id)!, snapshot))
    ) {
      throw new SceneSnapshotChangedError();
    }

    for (const replacement of replacements) {
      const snapshot = snapshots.find((scene) => scene.id === replacement.sceneId);
      if (!snapshot) throw new SceneSnapshotChangedError();
      const result = await tx
        .update(storyScenes)
        .set({ narrationKey: replacement.narrationKey, narrationUrl: replacement.narrationUrl })
        .where(sceneSnapshotCondition(snapshot));
      if (affectedRows(result) !== 1) throw new SceneSnapshotChangedError();
    }

    const orderResult = await tx
      .update(orders)
      .set({
        videoKey: uploadedVideo.key,
        videoUrl: uploadedVideo.url,
        errorMessage: null,
      })
      .where(recoveryLeaseCondition(orderId, lease.originalVideoKey, lease.marker));
    if (affectedRows(orderResult) !== 1) throw new LeaseLostError();
  });
}

const activeNarrationRecoveries = new Set<number>();

/** True while this process has queued or is processing the order. */
export function isNarrationRecovering(orderId: number): boolean {
  return activeNarrationRecoveries.has(orderId);
}

/**
 * Queue an explicit narration-only recovery. Adding to the local set happens
 * before setTimeout so two rapid clicks cannot queue duplicate local work.
 */
export function scheduleNarrationRecovery(orderId: number): boolean {
  if (activeNarrationRecoveries.has(orderId)) return false;

  activeNarrationRecoveries.add(orderId);
  setTimeout(() => {
    processNarrationRecovery(orderId)
      .catch(() => {
        // processNarrationRecovery handles failures after obtaining a lease.
        console.warn(`[NarrationRecovery] Unexpected queue failure for order ${orderId}`);
      })
      .finally(() => activeNarrationRecoveries.delete(orderId));
  }, 0);

  return true;
}

/**
 * Convert the internal lease/error convention into safe client state. This
 * intentionally never returns a lease token or raw provider error.
 */
export function getNarrationRecoveryState(order: { errorMessage?: string | null; updatedAt?: Date | string | null }): { pending: boolean; error: string | null } {
  const errorMessage = order.errorMessage || null;
  if (isLeaseMarker(errorMessage)) {
    const updatedAt = order.updatedAt ? new Date(order.updatedAt).getTime() : 0;
    if (updatedAt && updatedAt >= Date.now() - NARRATION_RECOVERY_STALE_MS) {
      return { pending: true, error: null };
    }
    return { pending: false, error: SAFE_RECOVERY_STALE };
  }

  if (errorMessage?.startsWith(NARRATION_RECOVERY_ERROR_PREFIX)) {
    return { pending: false, error: errorMessage };
  }

  return { pending: false, error: null };
}

/**
 * Offline-testable narration-only repair. It never splits a story, invokes an
 * LLM/image service, charges Stripe, deletes stored assets, or changes payment.
 */
export async function processNarrationRecovery(orderId: number): Promise<void> {
  const order = await getOrderById(orderId);
  if (!isEligibleForNarrationRecovery(order)) return;

  const db = await getDb();
  if (!db) return;

  let lease = await claimNarrationRecovery(db, order);
  if (!lease) return;

  try {
    const allScenes = await db
      .select()
      .from(storyScenes)
      .where(eq(storyScenes.orderId, orderId)) as SceneRow[];
    const snapshots = canonicalScenesFrom(allScenes);

    let voiceId = order.elevenlabsVoiceId || null;
    if (!voiceId) {
      const renewed = await renewNarrationRecoveryLease(db, orderId, lease);
      if (!renewed) throw new LeaseLostError();
      lease = renewed;

      const clonedVoiceId = await cloneVoiceWithElevenLabs(
        order.voiceSampleUrl || "",
        order.childName || "Child",
        order.voiceSampleKey || undefined
      );
      if (!clonedVoiceId) {
        throw new Error("A custom voice could not be prepared for narration recovery");
      }
      if (!await cacheClonedVoice(db, orderId, lease, clonedVoiceId)) {
        throw new LeaseLostError();
      }
      voiceId = clonedVoiceId;
    }

    const replacements: NarrationReplacement[] = [];
    for (const scene of snapshots) {
      const renewed = await renewNarrationRecoveryLease(db, orderId, lease);
      if (!renewed) throw new LeaseLostError();
      lease = renewed;

      const audio = await generateNarration(scene.sceneText, order.userId, orderId, {
        elevenlabsVoiceId: voiceId,
        requireCustomVoice: true,
      });
      if (!audio.audioKey || !audio.audioUrl) {
        throw new Error("Custom voice narration returned incomplete audio metadata");
      }
      replacements.push({
        sceneId: scene.id,
        narrationKey: audio.audioKey,
        narrationUrl: audio.audioUrl,
      });
    }

    const replacementBySceneId = new Map(replacements.map((replacement) => [replacement.sceneId, replacement]));
    const renewed = await renewNarrationRecoveryLease(db, orderId, lease);
    if (!renewed) throw new LeaseLostError();
    lease = renewed;

    const videoBuffer = await composeStorybookVideo(
      snapshots.map((scene) => {
        const replacement = replacementBySceneId.get(scene.id);
        if (!replacement) throw new Error("Narration replacement is missing for a canonical scene");
        return {
          sceneIndex: scene.sceneIndex,
          illustrationKey: scene.illustrationKey,
          illustrationUrl: scene.illustrationUrl,
          narrationKey: replacement.narrationKey,
          narrationUrl: replacement.narrationUrl,
        };
      }),
      order.storyTheme
    );
    if (!videoBuffer || videoBuffer.length === 0) {
      throw new Error("Narration recovery composition returned an empty MP4");
    }

    const afterComposition = await renewNarrationRecoveryLease(db, orderId, lease);
    if (!afterComposition) throw new LeaseLostError();
    lease = afterComposition;

    const namespace = getStorageNamespace(order.userId, orderId);
    const requestedVideoKey = `${namespace}/videos/${nanoid()}-storybook-h264420.mp4`;
    const uploadedVideo = await storagePut(requestedVideoKey, videoBuffer, "video/mp4");
    if (!uploadedVideo.key || !uploadedVideo.key.endsWith("-storybook-h264420.mp4") || !uploadedVideo.url) {
      throw new Error("Narration recovery video upload did not return a canonical MP4 key");
    }

    const afterUpload = await renewNarrationRecoveryLease(db, orderId, lease);
    if (!afterUpload) throw new LeaseLostError();
    lease = afterUpload;

    // The transaction verifies both the most recent lease marker and the full
    // pre-generation scene snapshot before changing any customer references.
    await commitNarrationRecovery(db, orderId, lease, snapshots, replacements, uploadedVideo);
  } catch (error) {
    if (error instanceof LeaseLostError) {
      console.warn(`[NarrationRecovery] Lease lost for order ${orderId}; leaving current assets untouched`);
      return;
    }

    // A transaction exception rolls back scene/video reference swaps first.
    // This safe error is written only while this exact worker still owns lease.
    await failNarrationRecovery(db, orderId, lease);
    console.warn(`[NarrationRecovery] Recovery failed for order ${orderId}; existing media was preserved`);
  }
}

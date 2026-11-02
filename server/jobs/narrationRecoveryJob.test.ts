import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  getDb: vi.fn(),
  cloneVoiceWithElevenLabs: vi.fn(),
  generateNarration: vi.fn(),
  composeStorybookVideo: vi.fn(),
  storagePut: vi.fn(),
  getStorageNamespace: vi.fn(),
  nanoid: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  like: vi.fn(),
  notLike: vi.fn(),
  lt: vi.fn(),
  orders: {
    id: "orders.id",
    status: "orders.status",
    paymentStatus: "orders.paymentStatus",
    storyApproved: "orders.storyApproved",
    videoKey: "orders.videoKey",
    errorMessage: "orders.errorMessage",
    updatedAt: "orders.updatedAt",
    elevenlabsVoiceId: "orders.elevenlabsVoiceId",
  },
  storyScenes: {
    id: "storyScenes.id",
    orderId: "storyScenes.orderId",
    sceneIndex: "storyScenes.sceneIndex",
    sceneText: "storyScenes.sceneText",
    illustrationPrompt: "storyScenes.illustrationPrompt",
    illustrationKey: "storyScenes.illustrationKey",
    illustrationUrl: "storyScenes.illustrationUrl",
    narrationKey: "storyScenes.narrationKey",
    narrationUrl: "storyScenes.narrationUrl",
    status: "storyScenes.status",
  },
}));

vi.mock("../db", () => ({ getOrderById: mocks.getOrderById, getDb: mocks.getDb }));
vi.mock("../../drizzle/schema", () => ({ orders: mocks.orders, storyScenes: mocks.storyScenes }));
vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  or: mocks.or,
  isNull: mocks.isNull,
  like: mocks.like,
  notLike: mocks.notLike,
  lt: mocks.lt,
}));
vi.mock("../services/ttsService", () => ({
  cloneVoiceWithElevenLabs: mocks.cloneVoiceWithElevenLabs,
  generateNarration: mocks.generateNarration,
}));
vi.mock("../services/videoComposition", () => ({ composeStorybookVideo: mocks.composeStorybookVideo }));
vi.mock("../storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("../services/storageNamespace", () => ({ getStorageNamespace: mocks.getStorageNamespace }));
vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));

import {
  getNarrationRecoveryState,
  isNarrationRecovering,
  processNarrationRecovery,
  scheduleNarrationRecovery,
} from "./narrationRecoveryJob";

type TestOrder = Record<string, any>;
type TestScene = Record<string, any>;

function order(overrides: Record<string, unknown> = {}): TestOrder {
  return {
    id: 22,
    userId: 7,
    status: "completed",
    paymentStatus: "paid",
    storyApproved: true,
    storyTheme: "adventure",
    childName: "Ari",
    voiceSampleKey: "orders/22/voice.webm",
    voiceSampleUrl: "https://legacy.invalid/voice.webm",
    elevenlabsVoiceId: null,
    videoKey: "orders/22/videos/original-storybook-h264420.mp4",
    videoUrl: "https://metadata.invalid/original.mp4",
    errorMessage: "voice_limit_reached 10/10",
    updatedAt: new Date(),
    ...overrides,
  };
}

function scene(overrides: Record<string, unknown> = {}): TestScene {
  return {
    id: 1,
    orderId: 22,
    sceneIndex: 0,
    sceneText: "Ari finds a bright star.",
    illustrationPrompt: "Ari finds a bright star in the forest.",
    illustrationKey: "orders/22/scenes/original-star.png",
    illustrationUrl: "https://metadata.invalid/original-star.png",
    narrationKey: "orders/22/narration/original-star.mp3",
    narrationUrl: "https://metadata.invalid/original-star.mp3",
    status: "completed",
    ...overrides,
  };
}

function findEqValue(condition: any, field: unknown): unknown {
  if (!condition || typeof condition !== "object") return undefined;
  if (condition.eq?.[0] === field) return condition.eq[1];
  for (const nested of [...(condition.and || []), ...(condition.or || [])]) {
    const found = findEqValue(nested, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

type DatabaseOptions = {
  claimAffectedRows?: number;
  renewAffectedRows?: number;
  cacheAffectedRows?: number;
  orderCommitAffectedRows?: number;
  mutateBeforeTransaction?: (order: TestOrder, scenes: TestScene[]) => void;
};

function createDatabase(initialOrder: TestOrder, initialScenes: TestScene[], options: DatabaseOptions = {}) {
  const storedOrder = { ...initialOrder };
  const scenes = initialScenes.map((entry) => ({ ...entry }));
  const orderSets: Record<string, unknown>[] = [];
  const sceneSets: Record<string, unknown>[] = [];
  let leaseWrites = 0;

  const rowsFor = (table: unknown) => table === mocks.orders
    ? [{ ...storedOrder }]
    : scenes.map((entry) => ({ ...entry }));

  const db: any = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: async () => rowsFor(table),
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          if (table === mocks.orders) {
            orderSets.push({ ...values });
            const isLeaseWrite = typeof values.errorMessage === "string" && values.errorMessage.startsWith("NarrationRecovery: lease:");
            if (isLeaseWrite) {
              leaseWrites += 1;
              const affectedRows = leaseWrites === 1
                ? (options.claimAffectedRows ?? 1)
                : (options.renewAffectedRows ?? 1);
              if (affectedRows === 1) Object.assign(storedOrder, values);
              return [{ affectedRows }, []];
            }
            if (Object.prototype.hasOwnProperty.call(values, "elevenlabsVoiceId")) {
              const affectedRows = options.cacheAffectedRows ?? 1;
              if (affectedRows === 1) Object.assign(storedOrder, values);
              return [{ affectedRows }, []];
            }
            if (Object.prototype.hasOwnProperty.call(values, "videoKey")) {
              const affectedRows = options.orderCommitAffectedRows ?? 1;
              if (affectedRows === 1) Object.assign(storedOrder, values);
              return [{ affectedRows }, []];
            }
            Object.assign(storedOrder, values);
            return [{ affectedRows: 1 }, []];
          }

          sceneSets.push({ ...values });
          const id = findEqValue(condition, mocks.storyScenes.id);
          const target = scenes.find((entry) => entry.id === id);
          if (target) Object.assign(target, values);
          return [{ affectedRows: target ? 1 : 0 }, []];
        },
      }),
    })),
    transaction: async (callback: (tx: any) => Promise<void>) => {
      options.mutateBeforeTransaction?.(storedOrder, scenes);
      const orderBefore = { ...storedOrder };
      const scenesBefore = scenes.map((entry) => ({ ...entry }));
      try {
        await callback(db);
      } catch (error) {
        Object.assign(storedOrder, orderBefore);
        scenes.splice(0, scenes.length, ...scenesBefore);
        throw error;
      }
    },
  };

  return { db, storedOrder, scenes, orderSets, sceneSets };
}

describe("narrationRecoveryJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockImplementation((field: unknown, value: unknown) => ({ eq: [field, value] }));
    mocks.and.mockImplementation((...conditions: unknown[]) => ({ and: conditions }));
    mocks.or.mockImplementation((...conditions: unknown[]) => ({ or: conditions }));
    mocks.isNull.mockImplementation((field: unknown) => ({ isNull: field }));
    mocks.like.mockImplementation((field: unknown, value: unknown) => ({ like: [field, value] }));
    mocks.notLike.mockImplementation((field: unknown, value: unknown) => ({ notLike: [field, value] }));
    mocks.lt.mockImplementation((field: unknown, value: unknown) => ({ lt: [field, value] }));
    mocks.nanoid.mockReturnValue("offline-token");
    mocks.getStorageNamespace.mockReturnValue("orders/22");
    mocks.cloneVoiceWithElevenLabs.mockResolvedValue("cloned-recorded-voice");
    mocks.generateNarration.mockImplementation(async (_text: string, _userId: number, _orderId: number, options: any) => ({
      audioKey: `orders/22/narration/${options.elevenlabsVoiceId}.mp3`,
      audioUrl: `https://metadata.invalid/${options.elevenlabsVoiceId}.mp3`,
    }));
    mocks.composeStorybookVideo.mockResolvedValue(Buffer.from("replacement-mp4"));
    mocks.storagePut.mockResolvedValue({
      key: "orders/22/videos/recovered-storybook-h264420.mp4",
      url: "https://metadata.invalid/recovered.mp4",
    });
  });

  it.each([
    ["unpaid", { paymentStatus: "unpaid" }],
    ["refunded", { paymentStatus: "refunded" }],
    ["unapproved", { storyApproved: false }],
    ["missing saved recording", { voiceSampleKey: null, voiceSampleUrl: null }],
    ["missing canonical video", { videoKey: null }],
    ["not completed", { status: "failed" }],
  ])("does no provider or database work for a %s order", async (_name, overrides) => {
    mocks.getOrderById.mockResolvedValue(order(overrides));

    await processNarrationRecovery(22);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.cloneVoiceWithElevenLabs).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("requires completed canonical illustrations before any voice or composition provider work", async () => {
    const initialOrder = order();
    const database = createDatabase(initialOrder, [scene({ illustrationKey: null })]);
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);

    await processNarrationRecovery(22);

    expect(mocks.cloneVoiceWithElevenLabs).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(database.storedOrder.videoKey).toBe(initialOrder.videoKey);
    expect(database.storedOrder.errorMessage).toContain("Narration recovery failed:");
  });

  it("does no provider work when the cross-instance claim CAS affects zero rows", async () => {
    const initialOrder = order();
    const database = createDatabase(initialOrder, [scene()], { claimAffectedRows: 0 });
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);

    await processNarrationRecovery(22);

    expect(mocks.cloneVoiceWithElevenLabs).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("preserves old narration and video when strict custom TTS reports quota failure", async () => {
    const initialOrder = order();
    const originalScene = scene();
    const database = createDatabase(initialOrder, [originalScene]);
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);
    mocks.generateNarration.mockRejectedValue(new Error("Custom voice narration failed"));

    await processNarrationRecovery(22);

    expect(mocks.generateNarration).toHaveBeenCalledWith(originalScene.sceneText, 7, 22, {
      elevenlabsVoiceId: "cloned-recorded-voice",
      requireCustomVoice: true,
    });
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(database.scenes[0]).toMatchObject({
      narrationKey: originalScene.narrationKey,
      narrationUrl: originalScene.narrationUrl,
      illustrationKey: originalScene.illustrationKey,
      sceneText: originalScene.sceneText,
    });
    expect(database.storedOrder).toMatchObject({
      videoKey: initialOrder.videoKey,
      videoUrl: initialOrder.videoUrl,
      paymentStatus: "paid",
      errorMessage: expect.stringContaining("Narration recovery failed:"),
    });
  });

  it("atomically swaps replacement narration and video while leaving story text and scene art untouched", async () => {
    const initialOrder = order();
    const first = scene();
    const second = scene({
      id: 2,
      sceneIndex: 1,
      sceneText: "Ari shares the star with a friend.",
      illustrationKey: "orders/22/scenes/original-friend.png",
      illustrationUrl: "https://metadata.invalid/original-friend.png",
      narrationKey: "orders/22/narration/original-friend.mp3",
      narrationUrl: "https://metadata.invalid/original-friend.mp3",
    });
    const database = createDatabase(initialOrder, [first, second]);
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);

    await processNarrationRecovery(22);

    expect(mocks.cloneVoiceWithElevenLabs).toHaveBeenCalledWith(
      initialOrder.voiceSampleUrl,
      initialOrder.childName,
      initialOrder.voiceSampleKey
    );
    expect(mocks.generateNarration).toHaveBeenCalledTimes(2);
    expect(mocks.generateNarration.mock.calls.every((call) => call[3]?.requireCustomVoice === true)).toBe(true);
    expect(mocks.composeStorybookVideo).toHaveBeenCalledWith([
      expect.objectContaining({
        sceneIndex: 0,
        illustrationKey: first.illustrationKey,
        narrationKey: "orders/22/narration/cloned-recorded-voice.mp3",
      }),
      expect.objectContaining({
        sceneIndex: 1,
        illustrationKey: second.illustrationKey,
        narrationKey: "orders/22/narration/cloned-recorded-voice.mp3",
      }),
    ], "adventure");
    expect(mocks.storagePut).toHaveBeenCalledWith(
      expect.stringMatching(/-storybook-h264420\.mp4$/),
      Buffer.from("replacement-mp4"),
      "video/mp4"
    );
    expect(database.scenes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: first.id,
        sceneText: first.sceneText,
        illustrationKey: first.illustrationKey,
        illustrationUrl: first.illustrationUrl,
        narrationKey: "orders/22/narration/cloned-recorded-voice.mp3",
      }),
      expect.objectContaining({
        id: second.id,
        sceneText: second.sceneText,
        illustrationKey: second.illustrationKey,
        illustrationUrl: second.illustrationUrl,
        narrationKey: "orders/22/narration/cloned-recorded-voice.mp3",
      }),
    ]));
    expect(database.storedOrder).toMatchObject({
      videoKey: "orders/22/videos/recovered-storybook-h264420.mp4",
      videoUrl: "https://metadata.invalid/recovered.mp4",
      paymentStatus: "paid",
      status: "completed",
      elevenlabsVoiceId: "cloned-recorded-voice",
      errorMessage: null,
    });
  });

  it("rejects an empty replacement MP4 without changing the old narration or video", async () => {
    const initialOrder = order();
    const originalScene = scene();
    const database = createDatabase(initialOrder, [originalScene]);
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);
    mocks.composeStorybookVideo.mockResolvedValue(Buffer.alloc(0));

    await processNarrationRecovery(22);

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(database.scenes[0]).toMatchObject({
      narrationKey: originalScene.narrationKey,
      narrationUrl: originalScene.narrationUrl,
    });
    expect(database.storedOrder).toMatchObject({
      videoKey: initialOrder.videoKey,
      videoUrl: initialOrder.videoUrl,
      errorMessage: expect.stringContaining("Narration recovery failed:"),
    });
  });

  it("reuses the saved cloned voice ID without cloning another provider voice", async () => {
    const initialOrder = order({ elevenlabsVoiceId: "already-cloned-voice" });
    const database = createDatabase(initialOrder, [scene()]);
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);

    await processNarrationRecovery(22);

    expect(mocks.cloneVoiceWithElevenLabs).not.toHaveBeenCalled();
    expect(mocks.generateNarration).toHaveBeenCalledWith(expect.any(String), 7, 22, {
      elevenlabsVoiceId: "already-cloned-voice",
      requireCustomVoice: true,
    });
  });

  it("rolls back scene/video swaps when the snapshot changes before commit", async () => {
    const initialOrder = order();
    const originalScene = scene();
    const database = createDatabase(initialOrder, [originalScene], {
      mutateBeforeTransaction: (_storedOrder, scenes) => {
        scenes[0].sceneText = "Changed outside this recovery";
      },
    });
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);

    await processNarrationRecovery(22);

    expect(database.scenes[0]).toMatchObject({
      sceneText: "Changed outside this recovery",
      narrationKey: originalScene.narrationKey,
      narrationUrl: originalScene.narrationUrl,
      illustrationKey: originalScene.illustrationKey,
    });
    expect(database.storedOrder.videoKey).toBe(initialOrder.videoKey);
    expect(database.storedOrder.errorMessage).toContain("Narration recovery failed:");
    expect(database.sceneSets).not.toContainEqual(expect.objectContaining({ narrationKey: expect.any(String) }));
  });

  it("does not clear a lease or partial media when final lease ownership CAS is lost", async () => {
    const initialOrder = order();
    const originalScene = scene();
    const database = createDatabase(initialOrder, [originalScene], { orderCommitAffectedRows: 0 });
    mocks.getOrderById.mockResolvedValue(initialOrder);
    mocks.getDb.mockResolvedValue(database.db);

    await processNarrationRecovery(22);

    expect(database.scenes[0]).toMatchObject({
      narrationKey: originalScene.narrationKey,
      narrationUrl: originalScene.narrationUrl,
    });
    expect(database.storedOrder.videoKey).toBe(initialOrder.videoKey);
    expect(database.storedOrder.errorMessage).toMatch(/^NarrationRecovery: lease:/);
    expect(database.orderSets).not.toContainEqual({ errorMessage: expect.stringContaining("Narration recovery failed:") });
  });

  it("returns safe client state and marks the local queue active before its timer runs", async () => {
    vi.useFakeTimers();
    const rawLease = "NarrationRecovery: lease:private-token:1";
    expect(getNarrationRecoveryState({ errorMessage: rawLease, updatedAt: new Date() })).toEqual({ pending: true, error: null });
    expect(getNarrationRecoveryState({ errorMessage: rawLease, updatedAt: new Date(Date.now() - 31 * 60 * 1000) })).toEqual({
      pending: false,
      error: "Narration recovery stalled: Your existing storybook is unchanged. Please try again.",
    });
    expect(getNarrationRecoveryState({ errorMessage: "Narration recovery failed: safe message", updatedAt: new Date() })).toEqual({
      pending: false,
      error: "Narration recovery failed: safe message",
    });

    mocks.getOrderById.mockResolvedValue(null);
    expect(scheduleNarrationRecovery(77)).toBe(true);
    expect(isNarrationRecovering(77)).toBe(true);
    expect(scheduleNarrationRecovery(77)).toBe(false);
    await vi.runAllTimersAsync();
    expect(isNarrationRecovering(77)).toBe(false);
    vi.useRealTimers();
  });
});

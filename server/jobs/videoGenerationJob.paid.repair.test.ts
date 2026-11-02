import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  getDb: vi.fn(),
  splitStoryIntoScenes: vi.fn(),
  generateImage: vi.fn(),
  generateNarration: vi.fn(),
  cloneVoiceWithElevenLabs: vi.fn(),
  storageReadBytes: vi.fn(),
  storagePut: vi.fn(),
  applyBrandWatermark: vi.fn(),
  getStorageNamespace: vi.fn(),
  notifyOwner: vi.fn(),
  composeStorybookVideo: vi.fn(),
  invokeLLM: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  isNull: vi.fn(),
  lt: vi.fn(),
  orders: {
    id: "orders.id",
    status: "orders.status",
    paymentStatus: "orders.paymentStatus",
    storyApproved: "orders.storyApproved",
    generatedImageKey: "orders.generatedImageKey",
    videoKey: "orders.videoKey",
    updatedAt: "orders.updatedAt",
  },
  storyScenes: {
    id: "storyScenes.id",
    orderId: "storyScenes.orderId",
  },
}));

vi.mock("../db", () => ({
  getOrderById: mocks.getOrderById,
  getDb: mocks.getDb,
}));
vi.mock("../../drizzle/schema", () => ({
  orders: mocks.orders,
  storyScenes: mocks.storyScenes,
}));
vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: mocks.and,
  or: mocks.or,
  isNull: mocks.isNull,
  lt: mocks.lt,
}));
vi.mock("../services/sceneSplitter", () => ({ splitStoryIntoScenes: mocks.splitStoryIntoScenes }));
vi.mock("../_core/imageGeneration", () => ({ generateImage: mocks.generateImage }));
vi.mock("../services/ttsService", () => ({
  generateNarration: mocks.generateNarration,
  cloneVoiceWithElevenLabs: mocks.cloneVoiceWithElevenLabs,
}));
vi.mock("../storage", () => ({
  storageReadBytes: mocks.storageReadBytes,
  storagePut: mocks.storagePut,
}));
vi.mock("../services/watermark", () => ({ applyBrandWatermark: mocks.applyBrandWatermark }));
vi.mock("../services/storageNamespace", () => ({ getStorageNamespace: mocks.getStorageNamespace }));
vi.mock("../_core/notification", () => ({ notifyOwner: mocks.notifyOwner }));
vi.mock("../services/videoComposition", () => ({ composeStorybookVideo: mocks.composeStorybookVideo }));
vi.mock("../_core/llm", () => ({ invokeLLM: mocks.invokeLLM }));
vi.mock("nanoid", () => ({ nanoid: vi.fn(() => "test-id") }));

import { processVideoGeneration } from "./videoGenerationJob";

type TestScene = {
  id: number;
  orderId: number;
  sceneIndex: number;
  sceneText: string;
  illustrationPrompt: string | null;
  illustrationKey: string | null;
  illustrationUrl: string | null;
  narrationKey: string | null;
  narrationUrl: string | null;
  status: string;
};

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 22,
    userId: 7,
    status: "completed",
    paymentStatus: "paid",
    storyApproved: true,
    story: "A kind adventure.",
    storyTheme: "adventure",
    childName: "Ari",
    childDescription: "curly hair",
    generatedImageKey: "orders/22/paid-character.png",
    generatedImageUrl: "https://unsigned.invalid/paid-character.png",
    originalImageKey: "orders/22/original.png",
    originalImageUrl: "https://unsigned.invalid/original.png",
    voiceSampleKey: null,
    voiceSampleUrl: null,
    elevenlabsVoiceId: null,
    videoKey: null,
    videoUrl: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

function findEqValue(condition: unknown, field: unknown): unknown {
  if (!condition || typeof condition !== "object") return undefined;
  const record = condition as { eq?: unknown[]; and?: unknown[] };
  if (record.eq?.[0] === field) return record.eq[1];
  for (const nested of record.and || []) {
    const found = findEqValue(nested, field);
    if (found !== undefined) return found;
  }
  return undefined;
}

function createDatabase(initialScenes: TestScene[] = [], claimAffectedRows = 1) {
  const scenes = initialScenes.map((scene) => ({ ...scene }));
  const orderSets: Record<string, unknown>[] = [];
  const sceneSets: Record<string, unknown>[] = [];
  let nextId = Math.max(0, ...scenes.map((scene) => scene.id)) + 1;

  const db = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: async (condition: unknown) => {
          if (table !== mocks.storyScenes) return [];
          const sceneId = findEqValue(condition, mocks.storyScenes.id);
          return sceneId === undefined
            ? scenes
            : scenes.filter((scene) => scene.id === sceneId);
        },
      }),
    })),
    insert: vi.fn(() => ({
      values: async (values: Record<string, unknown>) => {
        scenes.push({
          id: nextId++,
          orderId: values.orderId as number,
          sceneIndex: values.sceneIndex as number,
          sceneText: values.sceneText as string,
          illustrationPrompt: (values.illustrationPrompt as string | null) || null,
          illustrationKey: null,
          illustrationUrl: null,
          narrationKey: null,
          narrationUrl: null,
          status: values.status as string,
        });
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (condition: unknown) => {
          if (table === mocks.orders) {
            orderSets.push(values);
            if (values.status === "processing") return [{ affectedRows: claimAffectedRows }, []];
            return [{ affectedRows: 1 }, []];
          }
          sceneSets.push(values);
          const sceneId = findEqValue(condition, mocks.storyScenes.id);
          const scene = scenes.find((candidate) => candidate.id === sceneId);
          if (scene) Object.assign(scene, values);
          return { affectedRows: 1 };
        },
      }),
    })),
  };

  return { db, scenes, orderSets, sceneSets };
}

describe("videoGenerationJob paid private-S3 repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eq.mockImplementation((field: unknown, value: unknown) => ({ eq: [field, value] }));
    mocks.and.mockImplementation((...conditions: unknown[]) => ({ and: conditions }));
    mocks.or.mockImplementation((...conditions: unknown[]) => ({ or: conditions }));
    mocks.isNull.mockImplementation((field: unknown) => ({ isNull: field }));
    mocks.lt.mockImplementation((field: unknown, value: unknown) => ({ lt: [field, value] }));
    mocks.getOrderById.mockResolvedValue(order());
    mocks.splitStoryIntoScenes.mockResolvedValue([
      { sceneIndex: 0, sceneText: "Ari waves.", illustrationPrompt: "Ari waves in a meadow." },
    ]);
    mocks.storageReadBytes.mockImplementation(async (key: string) => {
      if (key === "orders/22/paid-character.png") {
        return { key, data: Buffer.from("private-character"), contentType: "image/jpeg" };
      }
      if (key === "generated/provider-scene.png") {
        return { key, data: Buffer.from("private-provider-result"), contentType: "image/png" };
      }
      throw new Error(`Unexpected key ${key}`);
    });
    mocks.generateImage.mockResolvedValue({
      key: "generated/provider-scene.png",
      url: "https://unsigned.invalid/provider-scene.png",
    });
    mocks.applyBrandWatermark.mockRejectedValue(new Error("watermark unavailable"));
    mocks.generateNarration.mockResolvedValue({
      audioKey: "orders/22/narration/scene.mp3",
      audioUrl: "https://metadata.invalid/scene.mp3",
    });
    mocks.composeStorybookVideo.mockResolvedValue(Buffer.from("video"));
    mocks.storagePut.mockResolvedValue({
      key: "orders/22/videos/final.mp4",
      url: "https://metadata.invalid/final.mp4",
    });
    mocks.getStorageNamespace.mockReturnValue("orders/22");
    mocks.invokeLLM.mockResolvedValue({
      choices: [{ message: { content: "A small child with curly hair, bright eyes, and a yellow jacket." } }],
    });
    mocks.cloneVoiceWithElevenLabs.mockResolvedValue(null);
    mocks.notifyOwner.mockResolvedValue(undefined);
  });

  it("uses the paid character key for the LLM and edit, then persists the validated provider key when watermarking fails", async () => {
    const database = createDatabase();
    mocks.getDb.mockResolvedValue(database.db);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await processVideoGeneration(22);

    expect(mocks.storageReadBytes).toHaveBeenCalledWith("orders/22/paid-character.png");
    expect(mocks.storageReadBytes).toHaveBeenCalledWith("generated/provider-scene.png");
    const llmInput = mocks.invokeLLM.mock.calls[0][0].messages[1].content[1].image_url.url;
    expect(llmInput).toBe(`data:image/jpeg;base64,${Buffer.from("private-character").toString("base64")}`);
    expect(mocks.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      originalImages: [{ storageKey: "orders/22/paid-character.png", mimeType: "image/png" }],
    }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.sceneSets).toContainEqual({
      illustrationKey: "generated/provider-scene.png",
      illustrationUrl: "https://unsigned.invalid/provider-scene.png",
    });
    expect(mocks.storagePut).toHaveBeenCalledTimes(1);
    expect(mocks.composeStorybookVideo).toHaveBeenCalledWith([
      expect.objectContaining({
        illustrationKey: "generated/provider-scene.png",
        narrationKey: "orders/22/narration/scene.mp3",
      }),
    ], "adventure");
    expect(database.orderSets).toContainEqual(expect.objectContaining({
      videoKey: "orders/22/videos/final.mp4",
      videoUrl: "https://metadata.invalid/final.mp4",
      status: "completed",
    }));
    vi.unstubAllGlobals();
  });

  it.each([
    ["unpaid", false, { paymentStatus: "unpaid" }],
    ["unapproved", false, { storyApproved: false }],
  ])("does no generation work for a %s order", async (_name, _unused, overrides) => {
    mocks.getOrderById.mockResolvedValue(order(overrides));

    await processVideoGeneration(22);

    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
  });

  it("honors a fresh cross-instance processing claim and does not call providers when affectedRows is zero", async () => {
    const database = createDatabase([], 0);
    mocks.getDb.mockResolvedValue(database.db);

    await processVideoGeneration(22);

    expect(database.orderSets).toContainEqual({ status: "processing" });
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
  });

  it("does not fall back to the unsigned character URL when its canonical key cannot be read", async () => {
    const database = createDatabase();
    mocks.getDb.mockResolvedValue(database.db);
    mocks.storageReadBytes.mockRejectedValue(new Error("AccessDenied"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(processVideoGeneration(22)).rejects.toThrow("AccessDenied");

    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(database.orderSets).toContainEqual({ status: "failed" });
    vi.unstubAllGlobals();
  });

  it("marks a scene failed on upload failure without writing the requested scene destination key", async () => {
    const database = createDatabase();
    mocks.getDb.mockResolvedValue(database.db);
    mocks.applyBrandWatermark.mockResolvedValue(Buffer.from("branded"));
    mocks.storagePut.mockRejectedValue(new Error("S3 upload failed"));

    await expect(processVideoGeneration(22)).rejects.toThrow("incomplete or missing illustrations");

    expect(database.scenes).toHaveLength(1);
    expect(database.scenes[0]).toMatchObject({
      status: "failed",
      illustrationKey: null,
      illustrationUrl: null,
    });
    expect(database.sceneSets).not.toContainEqual(expect.objectContaining({
      illustrationKey: expect.any(String),
    }));
  });

  it("does not compose a partial existing scene set without an explicit retry and releases the claim", async () => {
    const database = createDatabase([
      {
        id: 1,
        orderId: 22,
        sceneIndex: 0,
        sceneText: "Ready",
        illustrationPrompt: "Ready",
        illustrationKey: "orders/22/scenes/ready.png",
        illustrationUrl: "https://metadata.invalid/ready.png",
        narrationKey: null,
        narrationUrl: null,
        status: "completed",
      },
      {
        id: 2,
        orderId: 22,
        sceneIndex: 1,
        sceneText: "Missing",
        illustrationPrompt: "Missing",
        illustrationKey: null,
        illustrationUrl: null,
        narrationKey: null,
        narrationUrl: null,
        status: "failed",
      },
    ]);
    mocks.getDb.mockResolvedValue(database.db);

    await processVideoGeneration(22);

    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(database.orderSets).toContainEqual({ status: "failed" });
  });

  it("retries missing audio without regenerating an existing illustration", async () => {
    const database = createDatabase([{
      id: 1, orderId: 22, sceneIndex: 0, sceneText: "Ready image", illustrationPrompt: "Ready image",
      illustrationKey: "orders/22/scenes/ready.png", illustrationUrl: "https://metadata.invalid/ready.png",
      narrationKey: null, narrationUrl: null, status: "generating_audio",
    }]);
    mocks.getDb.mockResolvedValue(database.db);
    await processVideoGeneration(22, { retryMissingScenes: true });
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateNarration).toHaveBeenCalledOnce();
    expect(mocks.composeStorybookVideo).toHaveBeenCalledOnce();
  });

  it("reuses both stored assets when recovering a scene status after restart", async () => {
    const database = createDatabase([{
      id: 1, orderId: 22, sceneIndex: 0, sceneText: "Ready assets", illustrationPrompt: "Ready assets",
      illustrationKey: "orders/22/scenes/ready.png", illustrationUrl: "https://metadata.invalid/ready.png",
      narrationKey: "orders/22/narration/ready.mp3", narrationUrl: "https://metadata.invalid/ready.mp3", status: "generating_audio",
    }]);
    mocks.getDb.mockResolvedValue(database.db);
    await processVideoGeneration(22, { retryMissingScenes: true });
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).toHaveBeenCalledOnce();
  });

  it("does not upload or complete an empty MP4 from existing completed assets", async () => {
    const database = createDatabase([{
      id: 1, orderId: 22, sceneIndex: 0, sceneText: "Ready assets", illustrationPrompt: "Ready assets",
      illustrationKey: "orders/22/scenes/ready.png", illustrationUrl: "https://metadata.invalid/ready.png",
      narrationKey: "orders/22/narration/ready.mp3", narrationUrl: "https://metadata.invalid/ready.mp3", status: "completed",
    }]);
    mocks.getDb.mockResolvedValue(database.db);
    mocks.composeStorybookVideo.mockResolvedValue(Buffer.alloc(0));
    await expect(processVideoGeneration(22)).rejects.toThrow("empty MP4");
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
    expect(database.orderSets).not.toContainEqual(expect.objectContaining({ status: "completed" }));
    expect(database.orderSets).toContainEqual({ status: "failed" });
  });

  it("does not generate new scenes with a stock narrator when selected voice cloning fails", async () => {
    const database = createDatabase();
    mocks.getDb.mockResolvedValue(database.db);
    mocks.getOrderById.mockResolvedValue(order({ voiceSampleKey: "orders/22/voice.webm" }));
    mocks.cloneVoiceWithElevenLabs.mockResolvedValue(null);
    await expect(processVideoGeneration(22)).rejects.toThrow("Recorded voice cloning failed");
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.generateNarration).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
  });

  it("preserves an existing illustration and fails instead of silently completing a custom-voice audio failure", async () => {
    const database = createDatabase([{
      id: 1, orderId: 22, sceneIndex: 0, sceneText: "Ready image", illustrationPrompt: "Ready image",
      illustrationKey: "orders/22/scenes/ready.png", illustrationUrl: "https://metadata.invalid/ready.png",
      narrationKey: null, narrationUrl: null, status: "generating_audio",
    }]);
    mocks.getDb.mockResolvedValue(database.db);
    mocks.getOrderById.mockResolvedValue(order({ elevenlabsVoiceId: "OWN_VOICE_ONLY", voiceSampleKey: "orders/22/voice.webm" }));
    mocks.generateNarration.mockRejectedValue(new Error("Custom narrator unavailable"));
    await expect(processVideoGeneration(22, { retryMissingScenes: true })).rejects.toThrow("incomplete or missing illustrations");
    expect(mocks.generateNarration).toHaveBeenCalledWith("Ready image", 7, 22, { elevenlabsVoiceId: "OWN_VOICE_ONLY", requireCustomVoice: true });
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.composeStorybookVideo).not.toHaveBeenCalled();
    expect(database.scenes[0].illustrationKey).toBe("orders/22/scenes/ready.png");
    expect(database.scenes[0].status).toBe("failed");
  });
});

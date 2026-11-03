import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const s3 = vi.hoisted(() => {
  type StoredObject = { bytes: Buffer; eTag: string };
  type RequestRecord = {
    command: { input: Record<string, unknown>; kind: "get" | "put" };
    options: { abortSignal?: AbortSignal } | undefined;
  };

  const state = {
    objects: new Map<string, StoredObject>(),
    getErrors: new Map<string, unknown[]>(),
    putErrors: new Map<string, unknown[]>(),
    requests: [] as RequestRecord[],
    clients: [] as Array<{ config: unknown; destroyed: boolean }>,
    revision: 0,
  };

  class GetObjectCommand {
    readonly kind = "get" as const;
    constructor(readonly input: Record<string, unknown>) {}
  }

  class PutObjectCommand {
    readonly kind = "put" as const;
    constructor(readonly input: Record<string, unknown>) {}
  }

  const conditionalError = () => {
    const error = new Error("Precondition failed") as Error & {
      name: string;
      $metadata: { httpStatusCode: number };
    };
    error.name = "PreconditionFailed";
    error.$metadata = { httpStatusCode: 412 };
    return error;
  };

  class S3Client {
    destroyed = false;

    constructor(readonly config: unknown) {
      state.clients.push(this);
    }

    async send(
      command: GetObjectCommand | PutObjectCommand,
      options?: { abortSignal?: AbortSignal }
    ): Promise<{ Body?: { transformToByteArray: () => Promise<Uint8Array> }; ContentLength?: number; ETag?: string }> {
      state.requests.push({ command, options });
      const key = String(command.input.Key);
      const queuedErrors = command.kind === "get" ? state.getErrors.get(key) : state.putErrors.get(key);
      const queuedError = queuedErrors?.shift();
      if (queuedError) throw queuedError;

      if (command.kind === "get") {
        const stored = state.objects.get(key);
        if (!stored) {
          const error = new Error("No such key") as Error & { name: string };
          error.name = "NoSuchKey";
          throw error;
        }
        return {
          ETag: stored.eTag,
          ContentLength: stored.bytes.length,
          Body: {
            transformToByteArray: async () => new Uint8Array(stored.bytes),
          },
        };
      }

      const existing = state.objects.get(key);
      if (command.input.IfNoneMatch === "*" && existing) throw conditionalError();
      if (command.input.IfMatch && (!existing || command.input.IfMatch !== existing.eTag)) {
        throw conditionalError();
      }

      const body = command.input.Body;
      const bytes = Buffer.isBuffer(body)
        ? Buffer.from(body)
        : Buffer.from(body as Uint8Array);
      const eTag = `"mock-revision-${++state.revision}"`;
      state.objects.set(key, { bytes, eTag });
      return { ETag: eTag };
    }

    destroy() {
      this.destroyed = true;
    }
  }

  return { state, GetObjectCommand, PutObjectCommand, S3Client, conditionalError };
});

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: s3.GetObjectCommand,
  PutObjectCommand: s3.PutObjectCommand,
  S3Client: s3.S3Client,
}));

import {
  EXPERIENCE_CATALOG_KEY,
  ExperienceCatalogConflictError,
  ExperienceCatalogIntegrityError,
  getAdminExperienceCatalog,
  getOrderExperience,
  getPublicExperienceCatalog,
  musicSelectionSchema,
  resolveNewOrderExperience,
  saveExperienceTheme,
  saveOrderExperience,
  setExperienceThemePublished,
} from "./experienceCatalog";

import { MUSIC_PRESETS } from "../../shared/experienceCatalog";

const environmentNames = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "S3_REGION",
  "S3_BUCKET",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map(name => [name, process.env[name]])
);

function resetS3(): void {
  s3.state.objects.clear();
  s3.state.getErrors.clear();
  s3.state.putErrors.clear();
  s3.state.requests.length = 0;
  s3.state.clients.length = 0;
  s3.state.revision = 0;
}

function setS3Error(
  kind: "get" | "put",
  key: string,
  error: unknown
): void {
  const store = kind === "get" ? s3.state.getErrors : s3.state.putErrors;
  store.set(key, [error]);
}

function storedJson(key: string): any {
  const stored = s3.state.objects.get(key);
  if (!stored) throw new Error(`Expected stored object ${key}`);
  return JSON.parse(stored.bytes.toString("utf8"));
}

function makeS3Error(name: string, status?: number): Error & { name: string; $metadata?: { httpStatusCode: number } } {
  const error = new Error(name) as Error & { name: string; $metadata?: { httpStatusCode: number } };
  error.name = name;
  if (status !== undefined) error.$metadata = { httpStatusCode: status };
  return error;
}

beforeEach(() => {
  resetS3();
  process.env.AWS_ACCESS_KEY_ID = "test-access-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.S3_REGION = "us-east-1";
  process.env.S3_BUCKET = "private-test-bucket";
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network is forbidden"); }));
});

afterAll(() => {
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.unstubAllGlobals();
});

describe("experience catalog private S3 persistence", () => {
  it("seeds exactly the canonical eight themes only after an explicit missing-object response", async () => {
    const publicCatalog = await getPublicExperienceCatalog();

    expect(publicCatalog.themes).toHaveLength(8);
    expect(publicCatalog.themes.map(theme => theme.title)).toEqual([
      "Adventure",
      "Fairy Tale",
      "Space Explorer",
      "Underwater World",
      "Superhero",
      "Dinosaur Land",
      "Pirate Treasure",
      "Enchanted Forest",
    ]);
    expect(publicCatalog.themes.every(theme => !("storySetting" in theme) && !("storyTone" in theme))).toBe(true);
    expect(publicCatalog.themes[0]).not.toHaveProperty("published");
    expect(publicCatalog.music.map(preset => preset.available)).toEqual([true, true, true]);

    const document = storedJson(EXPERIENCE_CATALOG_KEY);
    expect(document.themes).toHaveLength(8);
    expect(document.themes[3]).toMatchObject({
      title: "Underwater World",
      storySetting: "An ocean adventure with colorful sea creatures, coral reefs, and hidden treasures",
      storyTone: "playful, colorful, and magical",
    });

    const seedPut = s3.state.requests.find(request => request.command.kind === "put");
    expect(seedPut?.command.input).toMatchObject({
      Bucket: "private-test-bucket",
      Key: EXPERIENCE_CATALOG_KEY,
      IfNoneMatch: "*",
      ContentType: "application/json; charset=utf-8",
    });
    expect(s3.state.clients.every(client => client.destroyed)).toBe(true);
    expect(s3.state.clients[0]?.config).toMatchObject({
      region: "us-east-1",
      credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
    });
    expect(s3.state.requests.every(request => request.options?.abortSignal instanceof AbortSignal)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not seed or reset when the bucket is absent, access is denied, JSON is corrupt, or the request fails", async () => {
    const noSuchBucket = makeS3Error("NoSuchBucket", 404);
    setS3Error("get", EXPERIENCE_CATALOG_KEY, noSuchBucket);
    await expect(getPublicExperienceCatalog()).rejects.toBe(noSuchBucket);
    expect(s3.state.requests.filter(request => request.command.kind === "put")).toHaveLength(0);

    resetS3();
    const accessDenied = makeS3Error("AccessDenied", 403);
    setS3Error("get", EXPERIENCE_CATALOG_KEY, accessDenied);
    await expect(getPublicExperienceCatalog()).rejects.toBe(accessDenied);
    expect(s3.state.requests.filter(request => request.command.kind === "put")).toHaveLength(0);

    resetS3();
    s3.state.objects.set(EXPERIENCE_CATALOG_KEY, {
      bytes: Buffer.from("{not valid json", "utf8"),
      eTag: '"corrupt"',
    });
    await expect(getPublicExperienceCatalog()).rejects.toBeInstanceOf(ExperienceCatalogIntegrityError);
    expect(s3.state.requests.filter(request => request.command.kind === "put")).toHaveLength(0);

    resetS3();
    const networkError = new Error("socket hang up");
    setS3Error("get", EXPERIENCE_CATALOG_KEY, networkError);
    await expect(getPublicExperienceCatalog()).rejects.toBe(networkError);
    expect(s3.state.requests.filter(request => request.command.kind === "put")).toHaveLength(0);

    resetS3();
    s3.state.objects.set(EXPERIENCE_CATALOG_KEY, {
      bytes: Buffer.alloc(64 * 1024 + 1, 32),
      eTag: '"oversized"',
    });
    await expect(getPublicExperienceCatalog()).rejects.toBeInstanceOf(ExperienceCatalogIntegrityError);
    expect(s3.state.requests.filter(request => request.command.kind === "put")).toHaveLength(0);
  });

  it("uses opaque If-Match revisions and maps conditional write failures to explicit conflicts", async () => {
    const initial = await getAdminExperienceCatalog();
    const revisedTheme = { ...initial.themes[0], title: "Adventure Updated" };
    setS3Error("put", EXPERIENCE_CATALOG_KEY, s3.conditionalError());

    await expect(saveExperienceTheme(initial.revision, revisedTheme)).rejects.toBeInstanceOf(
      ExperienceCatalogConflictError
    );

    const updatePut = s3.state.requests.filter(request => request.command.kind === "put").at(-1);
    expect(updatePut?.command.input).toMatchObject({ IfMatch: initial.revision });
    await expect(saveExperienceTheme("stale-revision", revisedTheme)).rejects.toBeInstanceOf(
      ExperienceCatalogConflictError
    );
  });

  it("hides rather than deletes a theme and keeps private prompts out of subsequent public results", async () => {
    const initial = await getAdminExperienceCatalog();
    const updated = await setExperienceThemePublished(initial.revision, "pirate", false);
    const publicCatalog = await getPublicExperienceCatalog();

    expect(updated.themes.find(theme => theme.id === "pirate")).toMatchObject({ published: false });
    expect(publicCatalog.themes.map(theme => theme.id)).not.toContain("pirate");
    expect(storedJson(EXPERIENCE_CATALOG_KEY).themes.find((theme: any) => theme.id === "pirate")).toMatchObject({
      published: false,
      storySetting: "A swashbuckling voyage on the high seas searching for hidden treasure",
      storyTone: "adventurous, playful, and mysterious",
    });
    expect(publicCatalog.themes.every(theme => !("storySetting" in theme) && !("storyTone" in theme))).toBe(true);
  });

  it("writes immutable snapshots, returns defensive copies, and permits only true missing sidecars to use legacy null", async () => {
    const snapshot = await resolveNewOrderExperience("adventure");
    expect(snapshot.music).toMatchObject({
      id: "playful-adventure",
      label: "Playful Adventure",
      assetPath: "/audio/kidzrstarz/playful-adventure-v1.mp3",
    });
    await expect(resolveNewOrderExperience("adventure", "none")).resolves.toMatchObject({ music: null });
    const preset = MUSIC_PRESETS.find(item => item.id === "playful-adventure")!;
    const previous = preset.available;
    try {
      preset.available = false;
      await expect(resolveNewOrderExperience("adventure", "playful-adventure")).rejects.toThrow(
        "selected music preset is unavailable"
      );
    } finally {
      preset.available = previous;
    }
    const originalKey = "guest-example/originals/photo-original.jpg";

    await saveOrderExperience(originalKey, snapshot);
    snapshot.theme.title = "Mutated after write";
    const firstRead = await getOrderExperience({ originalImageKey: originalKey, storyTheme: "adventure" });
    expect(firstRead?.theme.title).toBe("Adventure");
    if (firstRead) firstRead.theme.title = "Mutated returned value";
    const secondRead = await getOrderExperience({ originalImageKey: originalKey, storyTheme: "adventure" });
    expect(secondRead?.theme.title).toBe("Adventure");

    await expect(saveOrderExperience(originalKey, snapshot)).rejects.toBeInstanceOf(
      ExperienceCatalogConflictError
    );

    await expect(
      getOrderExperience({ originalImageKey: "guest-example/originals/no-sidecar.jpg", storyTheme: "adventure" })
    ).resolves.toBeNull();

    const forbiddenKey = "guest-example/originals/forbidden.jpg";
    const denied = makeS3Error("AccessDenied", 403);
    setS3Error("get", `${forbiddenKey}.experience.json`, denied);
    await expect(getOrderExperience({ originalImageKey: forbiddenKey, storyTheme: "adventure" })).rejects.toBe(denied);

    const corruptKey = "guest-example/originals/corrupt.jpg";
    s3.state.objects.set(`${corruptKey}.experience.json`, {
      bytes: Buffer.from("{}", "utf8"),
      eTag: '"corrupt-sidecar"',
    });
    await expect(getOrderExperience({ originalImageKey: corruptKey, storyTheme: "adventure" })).rejects.toBeInstanceOf(
      ExperienceCatalogIntegrityError
    );
  });

  it("retains frozen bundled versions and labels without allowing external music", () => {
    expect(musicSelectionSchema.parse({ id: "playful-adventure", label: "An archived label", assetPath: "/audio/kidzrstarz/playful-adventure-v12.mp3", volume: 0.12 }).assetPath).toContain("-v12.mp3");
    expect(musicSelectionSchema.safeParse({ id: "playful-adventure", label: "Playful Adventure", assetPath: "https://example.invalid/music.mp3", volume: 0.12 }).success).toBe(false);
  });

  it("keeps explicit none distinct from an enabled theme default", async () => {
    const preset = MUSIC_PRESETS.find(item => item.id === "playful-adventure")!;
    const previous = preset.available;
    try {
      preset.available = true;
      expect((await resolveNewOrderExperience("adventure")).music?.id).toBe("playful-adventure");
      expect((await resolveNewOrderExperience("adventure", "none")).music).toBeNull();
    } finally {
      preset.available = previous;
    }
  });
});

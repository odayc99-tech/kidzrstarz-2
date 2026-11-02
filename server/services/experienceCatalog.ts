import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import {
  MUSIC_GAIN,
  MUSIC_PRESETS,
  MUSIC_PRESET_IDS,
  NO_MUSIC_SELECTION,
  THEME_COLOR_VALUES,
  THEME_ICON_VALUES,
  type MusicPreset,
  type MusicPresetId,
  type MusicSelection,
  type OrderExperienceSnapshot,
  type PublicTheme,
  type ThemeDefinition,
} from "@shared/experienceCatalog";

export const EXPERIENCE_CATALOG_KEY = "config/experience/themes-v1.json";
export const ORDER_EXPERIENCE_SUFFIX = ".experience.json";

const CATALOG_VERSION = 1 as const;
const S3_TIMEOUT_MS = 30_000;
const MAX_CATALOG_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 16 * 1024;
const MAX_THEMES = 100;
const SNAPSHOT_CACHE_LIMIT = 200;

const nonBlankString = (maximum: number) =>
  z.string().min(1).max(maximum).refine(value => value.trim().length > 0, {
    message: "Value must not be blank",
  });

/** Stable IDs support legacy camelCase theme IDs while disallowing path-like input. */
export const themeIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][A-Za-z0-9-]*$/, "Theme IDs must be stable alphanumeric IDs");

export const musicPresetIdSchema = z.enum(MUSIC_PRESET_IDS);
export const expectedRevisionSchema = z.string().min(1).max(512);

export const themeDefinitionSchema = z
  .object({
    id: themeIdSchema,
    title: nonBlankString(100),
    description: nonBlankString(500),
    category: z
      .string()
      .min(1)
      .max(32)
      .regex(/^[a-z][a-z0-9-]*$/, "Category must be a short lowercase identifier"),
    icon: z.enum(THEME_ICON_VALUES),
    color: z.enum(THEME_COLOR_VALUES),
    storySetting: nonBlankString(1_000),
    storyTone: nonBlankString(300),
    defaultMusicId: musicPresetIdSchema.nullable(),
    featured: z.boolean(),
    sortOrder: z.number().int().min(0).max(9_999),
    published: z.boolean(),
  })
  .strict();

export const catalogDocumentSchema = z
  .object({
    version: z.literal(CATALOG_VERSION),
    themes: z.array(themeDefinitionSchema).min(1).max(MAX_THEMES),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const ids = new Set<string>();
    catalog.themes.forEach((theme, index) => {
      if (ids.has(theme.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate theme ID: ${theme.id}`,
          path: ["themes", index, "id"],
        });
      }
      ids.add(theme.id);
    });
  });

const presetById = new Map<MusicPresetId, MusicPreset>(
  MUSIC_PRESETS.map(preset => [preset.id, preset])
);

export const musicSelectionSchema = z
  .object({
    id: musicPresetIdSchema,
    label: nonBlankString(100),
    assetPath: z.string().min(1).max(256),
    volume: z.literal(MUSIC_GAIN),
  })
  .strict()
  .superRefine((selection, ctx) => {
    // Saved labels and versions are immutable history, not a live-preset lookup.
    // Keep historical bundled versions; only this preset's controlled path is valid.
    const allowedPath = new RegExp(`^/audio/kidzrstarz/${selection.id}-v[0-9]+\\.mp3$`);
    if (!allowedPath.test(selection.assetPath)) {
      ctx.addIssue({
        code: "custom",
        message: "Music selections must use a versioned approved preset asset",
      });
    }
  });

export const orderExperienceSnapshotSchema = z
  .object({
    version: z.literal(CATALOG_VERSION),
    theme: themeDefinitionSchema,
    music: musicSelectionSchema.nullable(),
    createdAtIso: z
      .string()
      .min(20)
      .max(64)
      .refine(value => !Number.isNaN(Date.parse(value)), {
        message: "createdAtIso must be an ISO date",
      }),
  })
  .strict();

export const originalImageKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine(
    key =>
      /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) &&
      !key.startsWith("/") &&
      !key.includes("//") &&
      !key.includes("\\") &&
      !key.includes(":") &&
      key.split("/").every(segment => segment !== "." && segment !== ".."),
    "An original image key must be a trusted relative S3 key"
  );

export const reorderThemeIdsSchema = z
  .array(themeIdSchema)
  .min(1)
  .max(MAX_THEMES)
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "Theme IDs must not be repeated" });
    }
  });

export type CatalogDocument = z.infer<typeof catalogDocumentSchema>;
export type ThemeDefinitionInput = z.infer<typeof themeDefinitionSchema>;
export type ExperienceCatalogPublicResult = {
  revision: string;
  themes: PublicTheme[];
  music: MusicPreset[];
};
export type ExperienceCatalogAdminResult = {
  revision: string;
  themes: ThemeDefinition[];
  music: MusicPreset[];
};

/** A revision or conditional-write mismatch; router callers receive tRPC CONFLICT. */
export class ExperienceCatalogConflictError extends Error {
  readonly statusCode = 409;

  constructor(message = "The experience catalog was changed by another editor. Refresh and try again.") {
    super(message);
    this.name = "ExperienceCatalogConflictError";
  }
}

/** Invalid caller input or an unavailable customer selection. */
export class ExperienceCatalogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperienceCatalogValidationError";
  }
}

/** A present but unusable private catalog/snapshot. It is never treated as absent. */
export class ExperienceCatalogIntegrityError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExperienceCatalogIntegrityError";
  }
}

class MissingPrivateObjectError extends Error {
  constructor(readonly key: string) {
    super(`Private S3 object does not exist: ${key}`);
    this.name = "MissingPrivateObjectError";
  }
}

type S3ReadResult = {
  bytes: Buffer;
  eTag?: string;
};

type LoadedCatalog = {
  catalog: CatalogDocument;
  revision: string;
};

type ImmutableSnapshot = Readonly<{
  version: 1;
  theme: Readonly<ThemeDefinition>;
  music: Readonly<MusicSelection> | null;
  createdAtIso: string;
}>;

const snapshotCache = new Map<string, ImmutableSnapshot>();

function getRequiredS3Config(): {
  bucket: string;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
} {
  const bucket = process.env.S3_BUCKET;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Experience catalog S3 configuration requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_REGION, and S3_BUCKET"
    );
  }

  return {
    bucket,
    region,
    credentials: { accessKeyId, secretAccessKey },
  };
}

function createS3Client(): S3Client {
  const { region, credentials } = getRequiredS3Config();
  // Explicit static credentials are intentional: never fall back to an ambient provider chain.
  return new S3Client({ region, credentials });
}

function isS3Missing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  // Do not infer absence from a bare 404: NoSuchBucket is also a 404 and must
  // surface. This function runs only after a GetObject request, so these named
  // errors are object-specific absence responses.
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey" ||
    candidate.Code === "NotFound" ||
    candidate.code === "NoSuchKey"
    || candidate.code === "NotFound"
  );
}

function isConditionalConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    candidate.$metadata?.httpStatusCode === 409 ||
    candidate.$metadata?.httpStatusCode === 412 ||
    candidate.name === "PreconditionFailed" ||
    candidate.name === "ConditionalRequestConflict" ||
    candidate.Code === "PreconditionFailed" ||
    candidate.code === "PreconditionFailed"
  );
}

async function readBoundedBody(body: unknown, key: string, maxBytes: number): Promise<Buffer> {
  const iterable = body as {
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
    transformToByteArray?: () => Promise<Uint8Array>;
  };

  // S3's Node response body is async iterable. Consume it incrementally so a
  // missing/misleading ContentLength cannot make this small configuration read
  // accumulate an unbounded object in memory.
  const iteratorFactory = iterable[Symbol.asyncIterator];
  if (typeof iteratorFactory === "function") {
    const chunks: Buffer[] = [];
    let byteLength = 0;
    const iterator = iteratorFactory.call(iterable);
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} returned a non-binary body`);
      }
      const chunk = Buffer.from(next.value);
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} exceeds its size limit`);
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, byteLength);
  }

  if (typeof iterable.transformToByteArray !== "function") {
    throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} returned an unreadable body`);
  }
  const bytes = Buffer.from(await iterable.transformToByteArray());
  if (bytes.length > maxBytes) {
    throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} exceeds its size limit`);
  }
  return bytes;
}

async function readPrivateObject(key: string, maxBytes: number): Promise<S3ReadResult> {
  const { bucket } = getRequiredS3Config();
  const client = createS3Client();

  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }
    );

    if (!response.Body) {
      throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} returned no body`);
    }
    if (response.ContentLength !== undefined && response.ContentLength > maxBytes) {
      throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} exceeds its size limit`);
    }

    const bytes = await readBoundedBody(response.Body, key, maxBytes);

    return { bytes, eTag: response.ETag };
  } catch (error) {
    if (isS3Missing(error)) throw new MissingPrivateObjectError(key);
    throw error;
  } finally {
    client.destroy();
  }
}

async function putPrivateJson(
  key: string,
  value: unknown,
  condition: { ifMatch: string } | { ifNoneMatch: "*" },
  maxBytes: number
): Promise<string | undefined> {
  const { bucket } = getRequiredS3Config();
  const body = Buffer.from(JSON.stringify(value), "utf8");
  if (body.length > maxBytes) {
    throw new ExperienceCatalogValidationError(`Private S3 object ${key} exceeds its size limit`);
  }
  const client = createS3Client();

  try {
    const response = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
        CacheControl: "no-store",
        ...("ifMatch" in condition
          ? { IfMatch: condition.ifMatch }
          : { IfNoneMatch: condition.ifNoneMatch }),
      }),
      { abortSignal: AbortSignal.timeout(S3_TIMEOUT_MS) }
    );
    return response.ETag;
  } catch (error) {
    if (isConditionalConflict(error)) throw new ExperienceCatalogConflictError();
    throw error;
  } finally {
    client.destroy();
  }
}

function parseJsonObject(bytes: Buffer, key: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new ExperienceCatalogIntegrityError(`Private S3 object ${key} contains invalid JSON`, {
      cause: error,
    });
  }
}

function parseCatalogDocument(value: unknown): CatalogDocument {
  const result = catalogDocumentSchema.safeParse(value);
  if (!result.success) {
    throw new ExperienceCatalogIntegrityError("Experience catalog has an invalid or unsupported schema");
  }
  return result.data;
}

function parseSnapshot(value: unknown): OrderExperienceSnapshot {
  const result = orderExperienceSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new ExperienceCatalogIntegrityError("Order experience snapshot has an invalid or unsupported schema");
  }
  return result.data;
}

function requireRevision(eTag: string | undefined): string {
  if (!eTag || eTag.length > 512) {
    throw new ExperienceCatalogIntegrityError("Experience catalog response did not contain a usable ETag revision");
  }
  return eTag;
}

function seedThemes(): ThemeDefinition[] {
  // storySetting and storyTone deliberately preserve server/services/storyGeneration.ts verbatim.
  return [
    {
      id: "adventure",
      title: "Adventure",
      description: "Exciting quests through magical lands",
      category: "classics",
      icon: "sparkles",
      color: "amber",
      storySetting: "An exciting quest through magical lands with challenges to overcome",
      storyTone: "thrilling, courageous, and wonder-filled",
      defaultMusicId: "playful-adventure",
      featured: true,
      sortOrder: 0,
      published: true,
    },
    {
      id: "fairytale",
      title: "Fairy Tale",
      description: "Enchanted forests & magical creatures",
      category: "classics",
      icon: "crown",
      color: "pink",
      storySetting: "A classic fairy tale with enchanted forests, magical creatures, and a happy ending",
      storyTone: "whimsical, enchanting, and dreamy",
      defaultMusicId: "magical-wonder",
      featured: true,
      sortOrder: 1,
      published: true,
    },
    {
      id: "space",
      title: "Space Explorer",
      description: "Journey through the stars",
      category: "classics",
      icon: "rocket",
      color: "indigo",
      storySetting: "A journey through the stars, visiting planets and meeting friendly aliens",
      storyTone: "awe-inspiring, curious, and cosmic",
      defaultMusicId: "playful-adventure",
      featured: true,
      sortOrder: 2,
      published: true,
    },
    {
      id: "underwater",
      title: "Underwater World",
      description: "Ocean adventures & sea creatures",
      category: "classics",
      icon: "fish",
      color: "cyan",
      storySetting: "An ocean adventure with colorful sea creatures, coral reefs, and hidden treasures",
      storyTone: "playful, colorful, and magical",
      defaultMusicId: "magical-wonder",
      featured: false,
      sortOrder: 3,
      published: true,
    },
    {
      id: "superhero",
      title: "Superhero",
      description: "Discover powers & save the day",
      category: "classics",
      icon: "shield",
      color: "red",
      storySetting: "Discovering special powers and using them to help friends and save the day",
      storyTone: "empowering, brave, and action-packed",
      defaultMusicId: "playful-adventure",
      featured: false,
      sortOrder: 4,
      published: true,
    },
    {
      id: "dinosaur",
      title: "Dinosaur Land",
      description: "Travel back to prehistoric times",
      category: "classics",
      icon: "bone",
      color: "green",
      storySetting: "Traveling back in time to meet friendly dinosaurs and explore a prehistoric world",
      storyTone: "exciting, educational, and fun",
      defaultMusicId: "playful-adventure",
      featured: false,
      sortOrder: 5,
      published: true,
    },
    {
      id: "pirate",
      title: "Pirate Treasure",
      description: "Swashbuckling treasure hunts",
      category: "classics",
      icon: "anchor",
      color: "yellow",
      storySetting: "A swashbuckling voyage on the high seas searching for hidden treasure",
      storyTone: "adventurous, playful, and mysterious",
      defaultMusicId: "playful-adventure",
      featured: false,
      sortOrder: 6,
      published: true,
    },
    {
      id: "enchantedForest",
      title: "Enchanted Forest",
      description: "Talking animals & secret paths",
      category: "classics",
      icon: "tree",
      color: "emerald",
      storySetting: "Exploring a magical forest filled with talking animals, fairies, and secret paths",
      storyTone: "gentle, magical, and heartwarming",
      defaultMusicId: "magical-wonder",
      featured: false,
      sortOrder: 7,
      published: true,
    },
  ];
}

function seedCatalog(): CatalogDocument {
  return catalogDocumentSchema.parse({ version: CATALOG_VERSION, themes: seedThemes() });
}

async function readExistingCatalog(): Promise<LoadedCatalog> {
  const stored = await readPrivateObject(EXPERIENCE_CATALOG_KEY, MAX_CATALOG_BYTES);
  return {
    catalog: parseCatalogDocument(parseJsonObject(stored.bytes, EXPERIENCE_CATALOG_KEY)),
    revision: requireRevision(stored.eTag),
  };
}

async function getCatalog(): Promise<LoadedCatalog> {
  try {
    return await readExistingCatalog();
  } catch (error) {
    if (!(error instanceof MissingPrivateObjectError)) throw error;
  }

  const seededCatalog = seedCatalog();
  try {
    const revision = requireRevision(
      await putPrivateJson(
        EXPERIENCE_CATALOG_KEY,
        seededCatalog,
        { ifNoneMatch: "*" },
        MAX_CATALOG_BYTES
      )
    );
    return { catalog: seededCatalog, revision };
  } catch (error) {
    // A competing instance may have seeded first. Read its durable state; do not overwrite/reset it.
    if (error instanceof ExperienceCatalogConflictError) return readExistingCatalog();
    throw error;
  }
}

function sortedThemes(themes: ThemeDefinition[]): ThemeDefinition[] {
  return [...themes].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

function cloneTheme(theme: ThemeDefinition): ThemeDefinition {
  return { ...theme };
}

function cloneMusicPresets(): MusicPreset[] {
  return MUSIC_PRESETS.map(preset => ({ ...preset }));
}

function toPublicTheme(theme: ThemeDefinition): PublicTheme {
  const {
    storySetting: _storySetting,
    storyTone: _storyTone,
    published: _published,
    ...publicTheme
  } = theme;
  return publicTheme;
}

function toAdminResult(loaded: LoadedCatalog): ExperienceCatalogAdminResult {
  return {
    revision: loaded.revision,
    themes: sortedThemes(loaded.catalog.themes).map(cloneTheme),
    music: cloneMusicPresets(),
  };
}

async function writeCatalog(expectedRevision: string, catalog: CatalogDocument): Promise<LoadedCatalog> {
  const revision = requireRevision(
    await putPrivateJson(EXPERIENCE_CATALOG_KEY, catalog, { ifMatch: expectedRevision }, MAX_CATALOG_BYTES)
  );
  return { catalog, revision };
}

async function updateCatalog(
  expectedRevision: string,
  change: (catalog: CatalogDocument) => CatalogDocument
): Promise<ExperienceCatalogAdminResult> {
  const expected = expectedRevisionSchema.safeParse(expectedRevision);
  if (!expected.success) {
    throw new ExperienceCatalogValidationError("A valid catalog revision is required");
  }

  const loaded = await getCatalog();
  if (loaded.revision !== expected.data) {
    throw new ExperienceCatalogConflictError();
  }

  const updated = parseCatalogDocument(change(loaded.catalog));
  return toAdminResult(await writeCatalog(loaded.revision, updated));
}

/** Returns only published display metadata and fixed music presets, never generation prompts. */
export async function getPublicExperienceCatalog(): Promise<ExperienceCatalogPublicResult> {
  const loaded = await getCatalog();
  return {
    revision: loaded.revision,
    themes: sortedThemes(loaded.catalog.themes)
      .filter(theme => theme.published)
      .map(theme => toPublicTheme(cloneTheme(theme))),
    music: cloneMusicPresets(),
  };
}

/** Returns the complete catalog for an authorized administrator. */
export async function getAdminExperienceCatalog(): Promise<ExperienceCatalogAdminResult> {
  return toAdminResult(await getCatalog());
}

/** Creates or updates one stable theme definition without deleting historical IDs. */
export async function saveExperienceTheme(
  expectedRevision: string,
  theme: ThemeDefinition
): Promise<ExperienceCatalogAdminResult> {
  const parsedTheme = themeDefinitionSchema.safeParse(theme);
  if (!parsedTheme.success) {
    throw new ExperienceCatalogValidationError("Theme definition is invalid");
  }

  return updateCatalog(expectedRevision, catalog => {
    const existingIndex = catalog.themes.findIndex(item => item.id === parsedTheme.data.id);
    const themes = [...catalog.themes];
    if (existingIndex === -1) themes.push(parsedTheme.data);
    else themes[existingIndex] = parsedTheme.data;
    return { ...catalog, themes };
  });
}

/** Hides or publishes an existing theme while preserving its historical definition. */
export async function setExperienceThemePublished(
  expectedRevision: string,
  id: string,
  published: boolean
): Promise<ExperienceCatalogAdminResult> {
  const parsedId = themeIdSchema.safeParse(id);
  if (!parsedId.success) throw new ExperienceCatalogValidationError("Theme ID is invalid");

  return updateCatalog(expectedRevision, catalog => {
    let found = false;
    const themes = catalog.themes.map(theme => {
      if (theme.id !== parsedId.data) return theme;
      found = true;
      return { ...theme, published };
    });
    if (!found) throw new ExperienceCatalogValidationError("Theme not found");
    return { ...catalog, themes };
  });
}

/** Applies a complete exact ordering of the current theme IDs. */
export async function reorderExperienceThemes(
  expectedRevision: string,
  ids: string[]
): Promise<ExperienceCatalogAdminResult> {
  const parsedIds = reorderThemeIdsSchema.safeParse(ids);
  if (!parsedIds.success) {
    throw new ExperienceCatalogValidationError("Theme order must contain distinct stable theme IDs");
  }

  return updateCatalog(expectedRevision, catalog => {
    const currentIds = new Set(catalog.themes.map(theme => theme.id));
    const requestedIds = new Set(parsedIds.data);
    if (
      currentIds.size !== requestedIds.size ||
      Array.from(currentIds).some(id => !requestedIds.has(id))
    ) {
      throw new ExperienceCatalogValidationError("Theme order must contain every current theme ID exactly once");
    }

    const order = new Map(parsedIds.data.map((id, index) => [id, index]));
    return {
      ...catalog,
      themes: catalog.themes.map(theme => ({
        ...theme,
        sortOrder: order.get(theme.id)!,
      })),
    };
  });
}

function createMusicSelection(preset: MusicPreset): MusicSelection {
  return {
    id: preset.id,
    label: preset.label,
    assetPath: preset.assetPath,
    volume: MUSIC_GAIN,
  };
}

/**
 * Resolves a published theme into the complete immutable settings needed for a new order.
 * An omitted musicId applies the theme default only when that preset is currently available;
 * explicitly requesting an unavailable preset is rejected rather than silently substituted.
 */
export async function resolveNewOrderExperience(
  themeId: string,
  musicId?: string
): Promise<OrderExperienceSnapshot> {
  const parsedThemeId = themeIdSchema.safeParse(themeId);
  if (!parsedThemeId.success) throw new ExperienceCatalogValidationError("Theme ID is invalid");

  const loaded = await getCatalog();
  const theme = loaded.catalog.themes.find(
    candidate => candidate.id === parsedThemeId.data && candidate.published
  );
  if (!theme) {
    throw new ExperienceCatalogValidationError("The selected theme is unavailable");
  }

  let music: MusicSelection | null = null;
  if (musicId === NO_MUSIC_SELECTION) {
    // "none" is a UI selection value, never a catalog preset or asset path.
    music = null;
  } else if (musicId !== undefined) {
    const parsedMusicId = musicPresetIdSchema.safeParse(musicId);
    if (!parsedMusicId.success) {
      throw new ExperienceCatalogValidationError("Music must be an approved preset or the no-music selection");
    }
    const preset = presetById.get(parsedMusicId.data)!;
    if (!preset.available) {
      throw new ExperienceCatalogValidationError("The selected music preset is unavailable");
    }
    music = createMusicSelection(preset);
  } else if (theme.defaultMusicId) {
    const preset = presetById.get(theme.defaultMusicId)!;
    // Compatibility behavior for clients that omit a theme default awaiting asset availability.
    if (preset.available) music = createMusicSelection(preset);
  }

  return {
    version: CATALOG_VERSION,
    theme: cloneTheme(theme),
    music,
    createdAtIso: new Date().toISOString(),
  };
}

function cloneSnapshot(snapshot: OrderExperienceSnapshot | ImmutableSnapshot): OrderExperienceSnapshot {
  return {
    version: snapshot.version,
    theme: cloneTheme(snapshot.theme),
    music: snapshot.music ? { ...snapshot.music } : null,
    createdAtIso: snapshot.createdAtIso,
  };
}

function cacheSnapshot(key: string, snapshot: OrderExperienceSnapshot): void {
  const frozenTheme = Object.freeze(cloneTheme(snapshot.theme));
  const frozenMusic = snapshot.music ? Object.freeze({ ...snapshot.music }) : null;
  const immutable = Object.freeze({
    version: snapshot.version,
    theme: frozenTheme,
    music: frozenMusic,
    createdAtIso: snapshot.createdAtIso,
  }) as ImmutableSnapshot;

  snapshotCache.delete(key);
  if (snapshotCache.size >= SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = snapshotCache.keys().next().value;
    if (oldestKey !== undefined) snapshotCache.delete(oldestKey);
  }
  snapshotCache.set(key, immutable);
}

function validateSnapshotForWrite(snapshot: OrderExperienceSnapshot): OrderExperienceSnapshot {
  const parsed = orderExperienceSnapshotSchema.safeParse(snapshot);
  if (!parsed.success) throw new ExperienceCatalogValidationError("Order experience snapshot is invalid");
  return parsed.data;
}

/** Writes an immutable sidecar using If-None-Match; retries must not overwrite an existing order experience. */
export async function saveOrderExperience(
  originalImageKey: string,
  snapshot: OrderExperienceSnapshot
): Promise<OrderExperienceSnapshot> {
  const parsedKey = originalImageKeySchema.safeParse(originalImageKey);
  if (!parsedKey.success) throw new ExperienceCatalogValidationError("Original image key is invalid");

  const validatedSnapshot = validateSnapshotForWrite(snapshot);
  const sidecarKey = `${parsedKey.data}${ORDER_EXPERIENCE_SUFFIX}`;
  await putPrivateJson(sidecarKey, validatedSnapshot, { ifNoneMatch: "*" }, MAX_SNAPSHOT_BYTES);
  cacheSnapshot(parsedKey.data, validatedSnapshot);
  return cloneSnapshot(validatedSnapshot);
}

/**
 * Returns a frozen-at-creation experience sidecar. Only a true missing S3 object uses the
 * legacy null fallback; permission, timeout, and corruption errors intentionally surface.
 */
export async function getOrderExperience(order: {
  originalImageKey: string;
  storyTheme: string;
}): Promise<OrderExperienceSnapshot | null> {
  void order.storyTheme;
  const parsedKey = originalImageKeySchema.safeParse(order.originalImageKey);
  if (!parsedKey.success) throw new ExperienceCatalogValidationError("Original image key is invalid");

  const cached = snapshotCache.get(parsedKey.data);
  if (cached) return cloneSnapshot(cached);

  const sidecarKey = `${parsedKey.data}${ORDER_EXPERIENCE_SUFFIX}`;
  try {
    const stored = await readPrivateObject(sidecarKey, MAX_SNAPSHOT_BYTES);
    const snapshot = parseSnapshot(parseJsonObject(stored.bytes, sidecarKey));
    cacheSnapshot(parsedKey.data, snapshot);
    return cloneSnapshot(snapshot);
  } catch (error) {
    if (error instanceof MissingPrivateObjectError) return null;
    throw error;
  }
}

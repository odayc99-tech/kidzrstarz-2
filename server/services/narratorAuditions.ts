import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import axios from "axios";
import {
  NARRATOR_AUDITION_MODEL,
  NARRATOR_AUDITION_PRESETS,
  NARRATOR_AUDITION_SETTINGS,
  NARRATOR_AUDITION_TEXT,
  type NarratorAuditionId,
  type NarratorAuditionResult,
} from "@shared/narratorAuditions";
import { storageGetSignedUrl } from "../storage";

const OUTPUT_FORMAT = "mp3_44100_128";
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_LEASE_BYTES = 1024;
const STORAGE_TIMEOUT_MS = 30_000;
const PROVIDER_TIMEOUT_MS = 60_000;
const LEASE_MS = 5 * 60_000;
// Be conservative about clock skew: an expiry at 'now' is not a takeover.
const EXPIRY_GRACE_MS = 5_000;
const inflight = new Map<string, Promise<NarratorAuditionResult>>();

type ErrorCode = "BUSY" | "UNAVAILABLE" | "INVALID_AUDIO" | "STORAGE";
const messages: Record<ErrorCode, string> = {
  BUSY: "This narrator audition is already being prepared. Please try again shortly.",
  UNAVAILABLE:
    "This native narrator audition is unavailable. No substitute voice or model was used.",
  INVALID_AUDIO:
    "The narrator audition audio could not be validated. No substitute audio was used.",
  STORAGE:
    "Private narrator audition storage is unavailable. Please try again later.",
};

/** Safe to expose to an administrator; never includes provider/S3 errors or credentials. */
export class NarratorAuditionError extends Error {
  constructor(readonly code: ErrorCode) {
    super(messages[code]);
    this.name = "NarratorAuditionError";
  }
}

type Config = {
  bucket: string;
  region: string;
  credentials: { accessKeyId: string; secretAccessKey: string };
};
type Preset = (typeof NARRATOR_AUDITION_PRESETS)[number];
type Lease = { version: 1; token: string; expiresAt: number };
type OwnedLease = { value: Lease; etag: string };

function config(): Config {
  const { S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY } =
    process.env;
  if (
    !S3_BUCKET ||
    !S3_REGION ||
    !AWS_ACCESS_KEY_ID ||
    !AWS_SECRET_ACCESS_KEY
  ) {
    throw new NarratorAuditionError("STORAGE");
  }
  return {
    bucket: S3_BUCKET,
    region: S3_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  };
}

function configIdentity(value: Config): string {
  // Isolate overlapping work by storage destination AND credentials, without keeping secrets in map keys.
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function checkConfig(expected: Config): void {
  if (configIdentity(config()) !== configIdentity(expected))
    throw new NarratorAuditionError("STORAGE");
}

function objectKey(preset: Preset): string {
  const recipe = JSON.stringify({
    version: 1,
    id: preset.id,
    voiceId: preset.voiceId,
    modelId: NARRATOR_AUDITION_MODEL,
    settings: NARRATOR_AUDITION_SETTINGS,
    text: NARRATOR_AUDITION_TEXT,
    outputFormat: OUTPUT_FORMAT,
  });
  const hash = createHash("sha256").update(recipe).digest("hex");
  return `kidzrstarz/narrator-auditions/v1/${preset.id}-${hash}.mp3`;
}

function hasErrorName(error: unknown, names: string[]): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; Code?: unknown; code?: unknown };
  return [value.name, value.Code, value.code].some(
    name => typeof name === "string" && names.includes(name)
  );
}

function missing(error: unknown): boolean {
  // A bare 404 (including NoSuchBucket), AccessDenied, and corrupt bodies are NOT absence.
  return hasErrorName(error, ["NoSuchKey", "NotFound"]);
}

function conflict(error: unknown): boolean {
  const status = (error as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;
  return (
    status === 409 ||
    status === 412 ||
    hasErrorName(error, ["PreconditionFailed", "ConditionalRequestConflict"])
  );
}

class StorageDeadlineError extends Error {}
async function deadline<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new StorageDeadlineError()),
          STORAGE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Validate complete MPEG-1 Layer III, 44.1 kHz / 128 kbps frames, not merely an ID3 prefix.
 * This is structural validation, not a decoder or a claim about the voice's audible quality.
 */
function validateAudio(bytes: unknown, contentType: unknown): Buffer {
  const mime =
    typeof contentType === "string"
      ? contentType.split(";", 1)[0].trim().toLowerCase()
      : "";
  if (
    !["audio/mpeg", "audio/mp3", "audio/x-mpeg", "audio/x-mp3"].includes(mime)
  ) {
    throw new NarratorAuditionError("INVALID_AUDIO");
  }
  if (!(bytes instanceof Uint8Array) && !(bytes instanceof ArrayBuffer))
    throw new NarratorAuditionError("INVALID_AUDIO");
  const length = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.length;
  if (!length || length > MAX_AUDIO_BYTES)
    throw new NarratorAuditionError("INVALID_AUDIO");
  const data =
    bytes instanceof ArrayBuffer ? Buffer.from(bytes) : Buffer.from(bytes);
  let offset = 0;
  if (data.subarray(0, 3).toString("ascii") === "ID3") {
    if (
      data.length < 10 ||
      ![2, 3, 4].includes(data[3]) ||
      data[4] === 255 ||
      data.subarray(6, 10).some(byte => byte > 127)
    ) {
      throw new NarratorAuditionError("INVALID_AUDIO");
    }
    const size =
      data[6] * 2 ** 21 + data[7] * 2 ** 14 + data[8] * 2 ** 7 + data[9];
    offset = 10 + size + (data[3] === 4 && data[5] & 0x10 ? 10 : 0);
  }
  let frames = 0;
  while (offset + 4 <= data.length) {
    if (
      data.length - offset === 128 &&
      data.subarray(offset, offset + 3).toString("ascii") === "TAG"
    ) {
      offset += 128;
      break;
    }
    const a = data[offset],
      b = data[offset + 1],
      c = data[offset + 2],
      d = data[offset + 3];
    if (
      a !== 255 ||
      (b & 0xfe) !== 0xfa ||
      (c & 0xfc) !== 0x90 ||
      (d & 3) === 2
    ) {
      throw new NarratorAuditionError("INVALID_AUDIO");
    }
    const frameLength = Math.floor((144 * 128_000) / 44_100) + ((c >> 1) & 1);
    if (offset + frameLength > data.length)
      throw new NarratorAuditionError("INVALID_AUDIO");
    offset += frameLength;
    frames++;
  }
  if (frames < 2 || offset !== data.length)
    throw new NarratorAuditionError("INVALID_AUDIO");
  return data;
}

// The existing read/upload helpers have no streaming limit or upload abort option.
// Use the same private SDK/config convention here, with explicit bounds; reuse private signing.
async function readBody(body: unknown, maxBytes: number): Promise<Buffer> {
  const stream = body as AsyncIterable<Uint8Array> & { destroy?: () => void };
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    if (!stream || typeof stream[Symbol.asyncIterator] !== "function")
      throw new NarratorAuditionError("STORAGE");
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array))
        throw new NarratorAuditionError("STORAGE");
      length += chunk.length;
      if (length > maxBytes) throw new NarratorAuditionError("STORAGE");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, length);
  } finally {
    stream?.destroy?.();
  }
}

async function cached(
  client: S3Client,
  key: string,
  expected: Config
): Promise<boolean> {
  checkConfig(expected);
  const stored = await client
    .send(new GetObjectCommand({ Bucket: expected.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    })
    .catch(error => {
      if (missing(error)) return undefined;
      throw new NarratorAuditionError("STORAGE");
    });
  if (!stored) return false;
  try {
    if (
      stored.ContentLength !== undefined &&
      (stored.ContentLength < 1 || stored.ContentLength > MAX_AUDIO_BYTES)
    ) {
      (stored.Body as { destroy?: () => void } | undefined)?.destroy?.();
      throw new NarratorAuditionError("INVALID_AUDIO");
    }
    const bytes = await deadline(readBody(stored.Body, MAX_AUDIO_BYTES));
    validateAudio(bytes, stored.ContentType);
    return true;
  } catch (error) {
    if (error instanceof NarratorAuditionError) throw error;
    throw new NarratorAuditionError("STORAGE");
  }
}

function etag(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new NarratorAuditionError("STORAGE");
  return value;
}

async function readLease(
  client: S3Client,
  bucket: string,
  key: string
): Promise<OwnedLease> {
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    {
      abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS),
    }
  );
  if (
    !result.Body ||
    (result.ContentLength !== undefined &&
      (result.ContentLength < 1 || result.ContentLength > MAX_LEASE_BYTES))
  ) {
    (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
    throw new NarratorAuditionError("STORAGE");
  }
  const bytes = await deadline(readBody(result.Body, MAX_LEASE_BYTES));
  const value = JSON.parse(bytes.toString("utf8")) as Lease;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.token !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value.token) ||
    !Number.isSafeInteger(value.expiresAt) ||
    value.expiresAt < 0
  ) {
    throw new NarratorAuditionError("STORAGE");
  }
  return { value, etag: etag(result.ETag) };
}

async function putLease(
  client: S3Client,
  bucket: string,
  key: string,
  value: Lease,
  condition: { IfMatch: string } | { IfNoneMatch: "*" }
): Promise<string> {
  const result = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(JSON.stringify(value)),
      ContentType: "application/json",
      CacheControl: "no-store",
      ...condition,
    }),
    { abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) }
  );
  return etag(result.ETag);
}

async function acquire(
  client: S3Client,
  bucket: string,
  key: string
): Promise<OwnedLease> {
  const value: Lease = {
    version: 1,
    token: randomUUID(),
    expiresAt: Date.now() + LEASE_MS,
  };
  try {
    return {
      value,
      etag: await putLease(client, bucket, key, value, { IfNoneMatch: "*" }),
    };
  } catch (error) {
    if (!conflict(error)) throw error;
  }
  // One bounded CAS attempt. Never loop/poll, replace a live owner, or assume a missing/malformed lease is expired.
  let previous: OwnedLease;
  try {
    previous = await readLease(client, bucket, key);
  } catch (error) {
    if (missing(error)) throw new NarratorAuditionError("BUSY");
    throw error;
  }
  if (previous.value.expiresAt > Date.now() - EXPIRY_GRACE_MS)
    throw new NarratorAuditionError("BUSY");
  try {
    return {
      value,
      etag: await putLease(client, bucket, key, value, {
        IfMatch: previous.etag,
      }),
    };
  } catch (error) {
    if (conflict(error)) throw new NarratorAuditionError("BUSY");
    throw error;
  }
}

async function assertOwned(
  client: S3Client,
  bucket: string,
  key: string,
  owned: OwnedLease,
  minimumRemainingMs: number
): Promise<void> {
  let current: OwnedLease;
  try {
    current = await readLease(client, bucket, key);
  } catch (error) {
    if (missing(error)) throw new NarratorAuditionError("BUSY");
    throw error;
  }
  if (
    current.etag !== owned.etag ||
    current.value.token !== owned.value.token ||
    current.value.expiresAt !== owned.value.expiresAt ||
    current.value.expiresAt <= Date.now() + minimumRemainingMs + EXPIRY_GRACE_MS
  ) {
    throw new NarratorAuditionError("BUSY");
  }
}

async function generate(preset: Preset): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new NarratorAuditionError("UNAVAILABLE");
  let response;
  try {
    // Exactly one native request. No retries, redirects, account/library operations, or fallback.
    response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${preset.voiceId}`,
      {
        text: NARRATOR_AUDITION_TEXT,
        model_id: NARRATOR_AUDITION_MODEL,
        voice_settings: { ...NARRATOR_AUDITION_SETTINGS },
      },
      {
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        params: { output_format: OUTPUT_FORMAT },
        responseType: "arraybuffer",
        timeout: PROVIDER_TIMEOUT_MS,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        maxContentLength: MAX_AUDIO_BYTES,
        maxBodyLength: 8192,
        maxRedirects: 0,
      }
    );
  } catch {
    throw new NarratorAuditionError("UNAVAILABLE");
  }
  if (response.status !== 200) throw new NarratorAuditionError("UNAVAILABLE");
  return validateAudio(response.data, response.headers?.["content-type"]);
}

async function run(
  preset: Preset,
  expected: Config,
  key: string
): Promise<NarratorAuditionResult> {
  const result = async (
    fromCache: boolean
  ): Promise<NarratorAuditionResult> => {
    checkConfig(expected);
    const signed = await deadline(storageGetSignedUrl(key, 600));
    return {
      id: preset.id,
      name: preset.name,
      label: preset.label,
      url: signed.url,
      fromCache,
      modelId: NARRATOR_AUDITION_MODEL,
    };
  };
  let client: S3Client | undefined;
  let owned: OwnedLease | undefined;
  let failure: unknown;
  const leaseKey = `${key}.lease.json`;
  try {
    client = new S3Client({
      region: expected.region,
      credentials: expected.credentials,
      maxAttempts: 1,
    });
    if (await cached(client, key, expected)) return await result(true);
    owned = await acquire(client, expected.bucket, leaseKey);
    if (await cached(client, key, expected)) return await result(true);
    await assertOwned(
      client,
      expected.bucket,
      leaseKey,
      owned,
      PROVIDER_TIMEOUT_MS + 2 * STORAGE_TIMEOUT_MS
    );
    checkConfig(expected);
    const audio = await generate(preset);
    await assertOwned(
      client,
      expected.bucket,
      leaseKey,
      owned,
      2 * STORAGE_TIMEOUT_MS
    );
    checkConfig(expected);
    try {
      // No ACL/public URL, retries, or late unbounded upload. Never overwrite an immutable cache.
      await client.send(
        new PutObjectCommand({
          Bucket: expected.bucket,
          Key: key,
          Body: audio,
          ContentType: "audio/mpeg",
          CacheControl: "private, max-age=31536000, immutable",
          IfNoneMatch: "*",
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) }
      );
    } catch (error) {
      if (conflict(error) && (await cached(client, key, expected)))
        return await result(true);
      throw error;
    }
    // Verify persisted bytes before signing; an upload success alone is not a reusable cache.
    if (!(await cached(client, key, expected)))
      throw new NarratorAuditionError("STORAGE");
    return await result(false);
  } catch (error) {
    failure = error;
    throw error instanceof NarratorAuditionError
      ? error
      : new NarratorAuditionError("STORAGE");
  } finally {
    try {
      if (client && owned) {
        try {
          // IAM has no DeleteObject. CAS an expired marker; a replaced owner cannot be clobbered.
          await putLease(
            client,
            expected.bucket,
            leaseKey,
            { ...owned.value, expiresAt: 0 },
            { IfMatch: owned.etag }
          );
        } catch (error) {
          if (!conflict(error) && !failure)
            throw new NarratorAuditionError("STORAGE");
        }
      }
    } finally {
      client?.destroy();
    }
  }
}

/** Router must admin-gate and require confirmCredits=true before calling this function.
 * Importing this module does not start work; only a future explicit action calls the provider.
 */
export function getNarratorAudition(
  id: NarratorAuditionId
): Promise<NarratorAuditionResult> {
  try {
    const preset = NARRATOR_AUDITION_PRESETS.find(
      candidate => candidate.id === id
    );
    if (!preset) throw new NarratorAuditionError("UNAVAILABLE");
    const expected = config();
    const key = objectKey(preset);
    const identity = `${configIdentity(expected)}:${key}`;
    const existing = inflight.get(identity);
    if (existing) return existing;
    const pending = run(preset, expected, key).finally(() => {
      if (inflight.get(identity) === pending) inflight.delete(identity);
    });
    inflight.set(identity, pending);
    return pending;
  } catch (error) {
    return Promise.reject(
      error instanceof NarratorAuditionError
        ? error
        : new NarratorAuditionError("STORAGE")
    );
  }
}

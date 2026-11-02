import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { storagePut, storageReadBytes } from "../storage";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 30_000;
const FFMPEG_TIMEOUT_MS = 10 * 60_000;
const PROBE_MAX_BUFFER = 1024 * 1024;
const FFMPEG_MAX_BUFFER = 8 * 1024 * 1024;

const pendingCompatibilityChecks = new Map<string, Promise<string>>();

type ProbeStream = {
  codec_name?: unknown;
  codec_type?: unknown;
  pix_fmt?: unknown;
};

type MediaProbe = {
  format?: { format_name?: unknown };
  streams?: ProbeStream[];
};

type S3Configuration = {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/**
 * Return a stored S3 key that can be delivered as a broadly compatible MP4.
 *
 * Callers must authorize access before calling this helper. This function only
 * works with canonical object keys and never accepts a URL as an input source.
 */
export function ensureCompatibleVideoKey(sourceKey: string): Promise<string> {
  const normalizedSourceKey = normalizeStoredKey(sourceKey);

  // These names are only produced by server-side composition/conversion jobs.
  // Do not spend an S3 read or transcode on a key that already carries a
  // trusted server-generated compatibility marker.
  if (hasTrustedCompatibilityMarker(normalizedSourceKey)) {
    return Promise.resolve(normalizedSourceKey);
  }

  const pending = pendingCompatibilityChecks.get(normalizedSourceKey);
  if (pending) return pending;

  const operation = ensureLegacyVideoCompatibility(normalizedSourceKey);
  const sharedOperation = operation.finally(() => {
    if (pendingCompatibilityChecks.get(normalizedSourceKey) === sharedOperation) {
      pendingCompatibilityChecks.delete(normalizedSourceKey);
    }
  });
  pendingCompatibilityChecks.set(normalizedSourceKey, sharedOperation);

  return sharedOperation;
}

async function ensureLegacyVideoCompatibility(sourceKey: string): Promise<string> {
  const derivativeKey = compatibleDerivativeKey(sourceKey);
  if (await derivativeAlreadyExists(derivativeKey)) {
    return derivativeKey;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kidzrstarz-video-"));
  const inputPath = path.join(temporaryDirectory, "source-video");
  const outputPath = path.join(temporaryDirectory, "compatible-video.mp4");

  try {
    const original = await storageReadBytes(sourceKey);
    await writeFile(inputPath, original.data);

    const sourceProbe = await inspectVideoIfPossible(inputPath);
    if (sourceProbe && isCompatibleMp4(sourceProbe)) {
      return sourceKey;
    }

    await transcodeToCompatibleMp4(inputPath, outputPath, sourceProbe);

    const outputProbe = await inspectVideo(outputPath);
    if (!isCompatibleMp4(outputProbe)) {
      throw new Error("ffmpeg output is not a compatible H.264 yuv420p MP4");
    }

    const uploaded = await storagePut(
      derivativeKey,
      await readFile(outputPath),
      "video/mp4"
    );
    return requireCanonicalStorageKey(uploaded.key);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

function normalizeStoredKey(sourceKey: string): string {
  if (typeof sourceKey !== "string") {
    throw new Error("A stored video key is required");
  }

  const key = sourceKey.replace(/^\/+/, "");
  if (!key.trim()) {
    throw new Error("A stored video key is required");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(key)) {
    throw new Error("A stored video key is required, not a URL");
  }

  return key;
}

function hasTrustedCompatibilityMarker(key: string): boolean {
  return (
    key.endsWith("-storybook-h264420.mp4") ||
    key.endsWith("-compatible-h264420-v1.mp4")
  );
}

function compatibleDerivativeKey(sourceKey: string): string {
  const slashIndex = sourceKey.lastIndexOf("/");
  const extensionIndex = sourceKey.lastIndexOf(".");
  const stem = extensionIndex > slashIndex ? sourceKey.slice(0, extensionIndex) : sourceKey;
  return `${stem}-compatible-h264420-v1.mp4`;
}

function configuredS3(): S3Configuration {
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Storage not configured");
  }

  return { region, bucket, accessKeyId, secretAccessKey };
}

async function derivativeAlreadyExists(derivativeKey: string): Promise<boolean> {
  const config = configuredS3();
  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  try {
    await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: derivativeKey }),
      { abortSignal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }
    );
    return true;
  } catch (error) {
    if (isMissingObjectError(error)) return false;
    throw error;
  } finally {
    client.destroy();
  }
}

function isMissingObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const awsError = error as {
    name?: unknown;
    Code?: unknown;
    code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const identifier = [awsError.name, awsError.Code, awsError.code];

  return (
    awsError.$metadata?.httpStatusCode === 404 ||
    identifier.some((value) => value === "NotFound" || value === "NoSuchKey")
  );
}

async function inspectVideoIfPossible(filePath: string): Promise<MediaProbe | null> {
  try {
    return await inspectVideo(filePath);
  } catch {
    // A malformed or unsupported source should still be handed to ffmpeg. The
    // post-conversion probe is intentionally not swallowed and is required.
    return null;
  }
}

async function inspectVideo(filePath: string): Promise<MediaProbe> {
  const completed = (await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=format_name:stream=codec_type,codec_name,pix_fmt",
      "-of",
      "json",
      filePath,
    ],
    {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: PROBE_MAX_BUFFER,
    }
  )) as unknown;
  // Node's native execFile promisifier returns { stdout, stderr }. Keeping the
  // fallback also lets a standard callback-style implementation be used safely.
  const stdout =
    completed && typeof completed === "object" && "stdout" in completed
      ? (completed as { stdout: unknown }).stdout
      : completed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(stdout));
  } catch {
    throw new Error("ffprobe did not return valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("ffprobe did not return media metadata");
  }
  return parsed as MediaProbe;
}

function isCompatibleMp4(probe: MediaProbe): boolean {
  const formatName = probe.format?.format_name;
  const isMp4 =
    typeof formatName === "string" &&
    formatName.split(",").some((name) => name.trim() === "mp4");
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const videoStreams = streams.filter((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");

  return (
    isMp4 &&
    videoStreams.length > 0 &&
    videoStreams.every(
      (stream) => stream.codec_name === "h264" && stream.pix_fmt === "yuv420p"
    ) &&
    audioStreams.every((stream) => stream.codec_name === "aac")
  );
}

async function transcodeToCompatibleMp4(
  inputPath: string,
  outputPath: string,
  sourceProbe: MediaProbe | null
): Promise<void> {
  const audioStreams = (sourceProbe?.streams ?? []).filter(
    (stream) => stream.codec_type === "audio"
  );
  const hasAudio = audioStreams.length > 0;
  const sourceAudioIsAac = hasAudio && audioStreams.every((stream) => stream.codec_name === "aac");
  const audioArguments = sourceProbe
    ? hasAudio
      ? ["-map", "0:a:0", "-c:a", sourceAudioIsAac ? "copy" : "aac"]
      : []
    : ["-map", "0:a:0?", "-c:a", "aac"];

  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    ...audioArguments,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-movflags",
    "+faststart",
    outputPath,
  ];

  await execFileAsync("ffmpeg", args, {
    encoding: "utf8",
    timeout: FFMPEG_TIMEOUT_MS,
    maxBuffer: FFMPEG_MAX_BUFFER,
  });
}

function requireCanonicalStorageKey(key: unknown): string {
  if (
    typeof key !== "string" ||
    !key.trim() ||
    key.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(key)
  ) {
    throw new Error("Storage upload did not return a canonical object key");
  }
  return key;
}

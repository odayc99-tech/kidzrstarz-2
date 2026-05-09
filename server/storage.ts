/**
 * Storage helpers — AWS S3 (kidzrstarz-upload bucket)
 *
 * The bucket has a public-read policy on all objects, so we use direct
 * public URLs instead of pre-signed URLs. This means URLs never expire
 * and the download button always works regardless of when the order was created.
 *
 * Public URL format: https://{bucket}.s3.{region}.amazonaws.com/{key}
 *
 * API surface:
 *   storagePut(relKey, data, contentType?)  -> { key, url }   (url is public)
 *   storageGet(relKey, expiresIn?)          -> { key, url }   (url is public, expiresIn ignored)
 *   storagePublicUrl(relKey)                -> string          (direct public URL)
 */

import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { withRetry } from "./services/retry";

// ─── Client factory ──────────────────────────────────────────────────────────

function getS3Client(): S3Client {
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 credentials missing: set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_REGION"
    );
  }

  return new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET env var is not set");
  return bucket;
}

function getRegion(): string {
  const region = process.env.S3_REGION;
  if (!region) throw new Error("S3_REGION env var is not set");
  return region;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

// ─── Public URL construction ─────────────────────────────────────────────────

/**
 * Construct a direct public S3 URL for an object.
 * Works because the bucket has a public-read policy on all objects.
 *
 * @param relKey  Relative storage key, e.g. "1/videos/story.mp4"
 * @returns       Direct public URL, e.g. "https://kidzrstarz-upload.s3.us-east-1.amazonaws.com/1/videos/story.mp4"
 */
export function storagePublicUrl(relKey: string): string {
  const bucket = getBucket();
  const region = getRegion();
  const key = normalizeKey(relKey);
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload bytes to S3 and return the storage key plus a direct public URL.
 *
 * @param relKey      Relative storage key, e.g. "1/originals/photo.jpg"
 * @param data        File content as Buffer, Uint8Array, or string
 * @param contentType MIME type (defaults to "application/octet-stream")
 * @returns           { key, url } — url is a direct public S3 URL (never expires)
 */
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const body: Buffer =
    typeof data === "string"
      ? Buffer.from(data, "utf8")
      : Buffer.from(data as Uint8Array);

  return withRetry(
    async () => {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        })
      );

      const url = storagePublicUrl(key);
      return { key, url };
    },
    { label: "S3 upload", maxRetries: 3, initialDelayMs: 2000 }
  );
}

/**
 * Return the direct public URL for an existing S3 object.
 * The expiresIn parameter is kept for API compatibility but is ignored —
 * public URLs never expire.
 *
 * @param relKey    Relative storage key
 * @param expiresIn Ignored (kept for API compatibility)
 * @returns         { key, url } — url is a direct public S3 URL
 */
export async function storageGet(
  relKey: string,
  expiresIn = 3600
): Promise<{ key: string; url: string }> {
  void expiresIn; // intentionally ignored — bucket is public
  const key = normalizeKey(relKey);
  const url = storagePublicUrl(key);
  return { key, url };
}

/**
 * Verify S3 connectivity — used in tests and health checks.
 * Returns true if the bucket is accessible with the configured credentials.
 */
export async function storageHealthCheck(): Promise<boolean> {
  try {
    const client = getS3Client();
    const bucket = getBucket();
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}

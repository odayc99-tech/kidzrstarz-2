content = """\
/**
 * Storage helpers — AWS S3 (kidzrstarz-upload bucket)
 *
 * All files are stored as private objects.
 * Public access is granted via pre-signed GET URLs (default 1-hour expiry).
 *
 * API surface is identical to the previous Manus proxy version so all call
 * sites (db.ts, jobs, services) continue to work without changes.
 *
 *   storagePut(relKey, data, contentType?)  -> { key, url }
 *   storageGet(relKey, expiresIn?)          -> { key, url }
 */

import {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\\/+/, "");
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Upload bytes to S3 and return the storage key plus a pre-signed GET URL.
 *
 * @param relKey      Relative storage key, e.g. "1/originals/photo.jpg"
 * @param data        File content as Buffer, Uint8Array, or string
 * @param contentType MIME type (defaults to "application/octet-stream")
 * @returns           { key, url } — url is a 1-hour pre-signed GET URL
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

      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 3600 }
      );

      return { key, url };
    },
    { label: "S3 upload", maxRetries: 3, initialDelayMs: 2000 }
  );
}

/**
 * Generate a pre-signed GET URL for an existing S3 object.
 *
 * @param relKey    Relative storage key
 * @param expiresIn Seconds until the URL expires (default: 3600 = 1 hour)
 * @returns         { key, url }
 */
export async function storageGet(
  relKey: string,
  expiresIn = 3600
): Promise<{ key: string; url: string }> {
  const client = getS3Client();
  const bucket = getBucket();
  const key = normalizeKey(relKey);

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );

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
"""

with open("/home/ubuntu/kidzrstarz/server/storage.ts", "w") as f:
    f.write(content)

print("storage.ts written successfully")

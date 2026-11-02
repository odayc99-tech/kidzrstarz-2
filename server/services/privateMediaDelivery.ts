import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storageGetSignedUrl } from "../storage";

/** Server callers must verify order ownership or the paid share token first. */
export async function privateMediaUrl(
  key: string | null | undefined,
  legacyUrl?: string | null
): Promise<string | null> {
  // Legacy records may have only a URL. Never fall back when a canonical key exists.
  if (!key) return legacyUrl || null;
  try {
    return (await storageGetSignedUrl(key)).url;
  } catch {
    return null;
  }
}

/** Only call with the canonical key loaded from an authorized order. */
export async function privateDownloadUrl(key: string, filename: string, contentType: string) {
  const normalizedKey = key.replace(/^\/+/, "");
  if (!normalizedKey || /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedKey)) {
    throw new Error("Invalid stored media key");
  }
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Storage not configured");
  }
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "-");
  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey } });
  try {
    const downloadUrl = await getSignedUrl(client, new GetObjectCommand({
      Bucket: bucket,
      Key: normalizedKey,
      ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
      ResponseContentType: contentType,
    }), { expiresIn: 300 });
    return { downloadUrl, filename: safeFilename };
  } finally {
    client.destroy();
  }
}

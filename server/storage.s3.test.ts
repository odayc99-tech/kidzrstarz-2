/**
 * S3 storage integration test
 *
 * Validates that the AWS credentials are correctly configured and the
 * kidzrstarz-upload bucket is accessible.
 *
 * Skipped automatically when AWS_ACCESS_KEY_ID is not set (CI / local dev
 * without credentials).
 */

import { describe, it, expect } from "vitest";
import { storageHealthCheck, storagePut, storageGet } from "./storage";

const hasCredentials =
  !!process.env.AWS_ACCESS_KEY_ID &&
  !!process.env.AWS_SECRET_ACCESS_KEY &&
  !!process.env.S3_BUCKET &&
  !!process.env.S3_REGION;

describe.skipIf(!hasCredentials)("S3 storage integration", () => {
  it("can reach the S3 bucket (health check)", async () => {
    const ok = await storageHealthCheck();
    expect(ok).toBe(true);
  }, 15_000);

  it("can upload and retrieve a small file", async () => {
    const key = `test/vitest-${Date.now()}.txt`;
    const content = "KidzRstarz S3 test";

    // Upload
    const { key: uploadedKey, url: uploadUrl } = await storagePut(
      key,
      content,
      "text/plain"
    );
    expect(uploadedKey).toBe(key);
    expect(uploadUrl).toContain("amazonaws.com");

    // Generate a fresh pre-signed URL
    const { url: getUrl } = await storageGet(key, 60);
    expect(getUrl).toContain("amazonaws.com");

    // Fetch the content via the pre-signed URL
    const resp = await fetch(getUrl);
    expect(resp.ok).toBe(true);
    const text = await resp.text();
    expect(text).toBe(content);
  }, 30_000);
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  construct: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  return {
    ...actual,
    S3Client: class {
      constructor(config: unknown) {
        mocks.construct(config);
      }
      send = mocks.send;
      destroy = mocks.destroy;
    },
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: mocks.sign }));

import { GetObjectCommand, HeadBucketCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  storageGet,
  storageGetSignedUrl,
  storageHealthCheck,
  storagePublicUrl,
  storagePut,
  storageReadBytes,
} from "./storage";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.send.mockReset();
  mocks.sign.mockReset().mockResolvedValue("https://signed.example.invalid/mock");
  vi.stubEnv("S3_REGION", "us-east-2");
  vi.stubEnv("S3_BUCKET", "kidzrstarz-staging");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "TEST_ONLY_FAKE_ACCESS_KEY");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "TEST_ONLY_FAKE_SECRET");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("External requests are forbidden in these tests");
  }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("storageReadBytes (mocked S3 only)", () => {
  it("uses configured credentials and GetObject, normalizes the key, and returns bytes and MIME type", async () => {
    const bytes = Uint8Array.from([10, 20, 30]);
    const read = vi.fn().mockResolvedValue(bytes);
    mocks.send.mockResolvedValue({ Body: { transformToByteArray: read }, ContentType: "image/jpeg" });

    const result = await storageReadBytes("///3/originals/test-original.jpg");

    expect(mocks.construct).toHaveBeenCalledWith({
      region: "us-east-2",
      credentials: { accessKeyId: "TEST_ONLY_FAKE_ACCESS_KEY", secretAccessKey: "TEST_ONLY_FAKE_SECRET" },
    });
    const [command, options] = mocks.send.mock.calls[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: "kidzrstarz-staging", Key: "3/originals/test-original.jpg" });
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(read).toHaveBeenCalledOnce();
    expect(result).toEqual({ key: "3/originals/test-original.jpg", data: Buffer.from(bytes), contentType: "image/jpeg" });
    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("allows a response without a MIME type", async () => {
    mocks.send.mockResolvedValue({ Body: { transformToByteArray: async () => Uint8Array.from([1]) } });
    const result = await storageReadBytes("3/originals/test.jpg");
    expect(result.contentType).toBeUndefined();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("rejects missing file data and cleans up the client", async () => {
    mocks.send.mockResolvedValue({});
    await expect(storageReadBytes("3/originals/test.jpg")).rejects.toThrow("S3 returned no file data");
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("propagates an S3 denial and cleans up the client", async () => {
    const denied = Object.assign(new Error("Mock AccessDenied"), { name: "AccessDenied" });
    mocks.send.mockRejectedValue(denied);
    await expect(storageReadBytes("3/originals/test.jpg")).rejects.toBe(denied);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("propagates a body-stream error and cleans up the client", async () => {
    const failed = new Error("Mock stream failure");
    mocks.send.mockResolvedValue({ Body: { transformToByteArray: vi.fn().mockRejectedValue(failed) } });
    await expect(storageReadBytes("3/originals/test.jpg")).rejects.toBe(failed);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it.each(["", "///"])("rejects an empty key (%j) before any S3 operation", async (key) => {
    await expect(storageReadBytes(key)).rejects.toThrow("An S3 object key is required");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it.each(["https://example.invalid/photo.jpg", "s3://another-bucket/photo.jpg"])("rejects a URL (%s) rather than fetch it", async (url) => {
    await expect(storageReadBytes(url)).rejects.toThrow("Use an S3 object key, not a URL");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it("does not send a request if AWS credentials are missing", async () => {
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    await expect(storageReadBytes("3/originals/test.jpg")).rejects.toThrow("S3 credentials missing");
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not create a client or send a request if the bucket is missing", async () => {
    vi.stubEnv("S3_BUCKET", "");
    await expect(storageReadBytes("3/originals/test.jpg")).rejects.toThrow("S3_BUCKET env var is not set");
    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("legacy storage behavior is unchanged", () => {
  it("keeps storagePublicUrl and storageGet as URL-only legacy helpers", async () => {
    const expected = "https://kidzrstarz-staging.s3.us-east-2.amazonaws.com/3/test.jpg";
    expect(storagePublicUrl("/3/test.jpg")).toBe(expected);
    expect(await storageGet("/3/test.jpg", 60)).toEqual({ key: "3/test.jpg", url: expected });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps authenticated uploads unchanged", async () => {
    mocks.send.mockResolvedValue({});
    const result = await storagePut("/3/test.jpg", Buffer.from([1, 2]), "image/jpeg");
    const [command] = mocks.send.mock.calls[0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toEqual({ Bucket: "kidzrstarz-staging", Key: "3/test.jpg", Body: Buffer.from([1, 2]), ContentType: "image/jpeg" });
    expect(result).toEqual({ key: "3/test.jpg", url: "https://kidzrstarz-staging.s3.us-east-2.amazonaws.com/3/test.jpg" });
  });

  it("keeps the bucket health check unchanged", async () => {
    mocks.send.mockResolvedValue({});
    expect(await storageHealthCheck()).toBe(true);
    expect(mocks.send.mock.calls[0][0]).toBeInstanceOf(HeadBucketCommand);
  });
});

describe("storageGetSignedUrl (mocked signer; no S3 requests)", () => {
  it("signs the normalized key in the configured bucket with a ten-minute default", async () => {
    const result = await storageGetSignedUrl("///sign/normalization/test.jpg");
    expect(result).toEqual({ key: "sign/normalization/test.jpg", url: "https://signed.example.invalid/mock" });
    const [client, command, options] = mocks.sign.mock.calls[0];
    expect(client.send).toBe(mocks.send);
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input).toEqual({ Bucket: "kidzrstarz-staging", Key: "sign/normalization/test.jpg" });
    expect(options).toEqual({ expiresIn: 600 });
    expect(mocks.construct).toHaveBeenCalledWith({
      region: "us-east-2",
      credentials: { accessKeyId: "TEST_ONLY_FAKE_ACCESS_KEY", secretAccessKey: "TEST_ONLY_FAKE_SECRET" },
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("accepts an explicit bounded expiry", async () => {
    await storageGetSignedUrl("sign/expiry/test.jpg", 120);
    expect(mocks.sign.mock.calls[0][2]).toEqual({ expiresIn: 120 });
  });

  it("reuses a link while valid, does not extend it, and refreshes before expiry", async () => {
    const base = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(base);
    mocks.sign.mockResolvedValueOnce("first-link").mockResolvedValueOnce("refreshed-link");
    const first = await storageGetSignedUrl("sign/time/test.jpg");
    clock.mockReturnValue(base + 300_000);
    const cached = await storageGetSignedUrl("sign/time/test.jpg");
    expect(cached).toEqual(first);
    expect(mocks.sign).toHaveBeenCalledOnce();
    clock.mockReturnValue(base + 541_000);
    expect(await storageGetSignedUrl("sign/time/test.jpg")).toEqual({ key: "sign/time/test.jpg", url: "refreshed-link" });
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(mocks.destroy).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 1.5, 3601, NaN, Infinity])("rejects invalid expiry %s before signing", async (expiry) => {
    await expect(storageGetSignedUrl("sign/invalid-expiry/test.jpg", expiry)).rejects.toThrow("Signed-link expiry must be 1 to 3600 whole seconds");
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
  });

  it.each(["", "///", "https://example.invalid/photo.jpg"])("rejects a missing key or URL (%s) before signing", async (key) => {
    await expect(storageGetSignedUrl(key)).rejects.toThrow();
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not reuse a link after the access-key identity changes", async () => {
    mocks.sign.mockResolvedValueOnce("old-identity-link").mockResolvedValueOnce("new-identity-link");
    await storageGetSignedUrl("sign/identity/test.jpg");
    vi.stubEnv("AWS_ACCESS_KEY_ID", "OTHER_TEST_ONLY_FAKE_ACCESS_KEY");
    expect(await storageGetSignedUrl("sign/identity/test.jpg")).toEqual({ key: "sign/identity/test.jpg", url: "new-identity-link" });
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a link across bucket or region settings", async () => {
    mocks.sign.mockResolvedValueOnce("bucket-one").mockResolvedValueOnce("bucket-two").mockResolvedValueOnce("region-two");
    await storageGetSignedUrl("sign/config/test.jpg");
    vi.stubEnv("S3_BUCKET", "another-test-only-bucket");
    expect((await storageGetSignedUrl("sign/config/test.jpg")).url).toBe("bucket-two");
    vi.stubEnv("S3_REGION", "us-west-2");
    expect((await storageGetSignedUrl("sign/config/test.jpg")).url).toBe("region-two");
    expect(mocks.sign).toHaveBeenCalledTimes(3);
  });

  it("requires credentials even when a cached link exists", async () => {
    await storageGetSignedUrl("sign/missing-credential/test.jpg");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "");
    await expect(storageGetSignedUrl("sign/missing-credential/test.jpg")).rejects.toThrow("S3 credentials missing");
    expect(mocks.sign).toHaveBeenCalledOnce();
  });

  it("propagates signer errors, closes the client, and does not cache a failure", async () => {
    const failure = new Error("Mock signing failure");
    mocks.sign.mockRejectedValueOnce(failure).mockResolvedValueOnce("retry-link");
    await expect(storageGetSignedUrl("sign/failure/test.jpg")).rejects.toBe(failure);
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(await storageGetSignedUrl("sign/failure/test.jpg")).toEqual({ key: "sign/failure/test.jpg", url: "retry-link" });
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("bounds cached links to 500 entries", async () => {
    const limit = 500;
    for (let index = 0; index < limit; index++) {
      await storageGetSignedUrl(`sign/bound/${index}.jpg`);
    }
    await storageGetSignedUrl("sign/bound/0.jpg");
    expect(mocks.sign).toHaveBeenCalledTimes(limit);
    await storageGetSignedUrl(`sign/bound/${limit}.jpg`);
    await storageGetSignedUrl("sign/bound/0.jpg");
    expect(mocks.sign).toHaveBeenCalledTimes(limit + 2);
  });
});

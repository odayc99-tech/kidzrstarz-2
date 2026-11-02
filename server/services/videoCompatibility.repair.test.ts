import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
  storageReadBytes: vi.fn(),
  storagePut: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn(),
  execFile: vi.fn(),
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

vi.mock("../storage", () => ({
  storageReadBytes: mocks.storageReadBytes,
  storagePut: mocks.storagePut,
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  readFile: mocks.readFile,
  rm: mocks.rm,
}));

vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));

import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { ensureCompatibleVideoKey } from "./videoCompatibility";

const sourceKey = "orders/41/videos/provider-export.mp4";
const derivativeKey = "orders/41/videos/provider-export-compatible-h264420-v1.mp4";
const concurrentSourceKey = "orders/41/videos/concurrent-provider-export.mp4";
const tempDirectory = "/tmp/kidzrstarz-video-test";
const sourcePath = `${tempDirectory}/source-video`;
const outputPath = `${tempDirectory}/compatible-video.mp4`;

function missingObjectError() {
  return Object.assign(new Error("Not found"), {
    name: "NotFound",
    $metadata: { httpStatusCode: 404 },
  });
}

function probeJson({
  pixelFormat = "yuv420p",
  audioCodec = "aac",
  includeAudio = true,
}: {
  pixelFormat?: string;
  audioCodec?: string;
  includeAudio?: boolean;
} = {}) {
  return JSON.stringify({
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
    streams: [
      { codec_type: "video", codec_name: "h264", pix_fmt: pixelFormat },
      ...(includeAudio ? [{ codec_type: "audio", codec_name: audioCodec }] : []),
    ],
  });
}

function mockProcessSuccess(stdout = "") {
  mocks.execFile.mockImplementation(
    (_file: string, _args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
      callback(null, stdout, "");
    }
  );
}

function configureMissingDerivative() {
  mocks.send.mockRejectedValue(missingObjectError());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("S3_REGION", "us-east-2");
  vi.stubEnv("S3_BUCKET", "test-private-video-bucket");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "TEST_ONLY_ACCESS_KEY");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "TEST_ONLY_SECRET");

  mocks.mkdtemp.mockResolvedValue(tempDirectory);
  mocks.writeFile.mockResolvedValue(undefined);
  mocks.readFile.mockResolvedValue(Buffer.from("transcoded-private-bytes"));
  mocks.rm.mockResolvedValue(undefined);
  mocks.storageReadBytes.mockResolvedValue({
    key: sourceKey,
    data: Buffer.from("private-original-video"),
    contentType: "video/mp4",
  });
  mocks.storagePut.mockResolvedValue({
    key: derivativeKey,
    url: "https://not-used.example.invalid/private-video.mp4",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("ensureCompatibleVideoKey", () => {
  it.each([
    "orders/41/videos/story-storybook-h264420.mp4",
    "orders/41/videos/story-compatible-h264420-v1.mp4",
  ])("returns trusted server-generated marker keys without I/O (%s)", async (key) => {
    await expect(ensureCompatibleVideoKey(key)).resolves.toBe(key);

    expect(mocks.construct).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it("returns an existing derivative after an explicit configured HeadObject check", async () => {
    mocks.send.mockResolvedValue({});

    await expect(ensureCompatibleVideoKey(sourceKey)).resolves.toBe(derivativeKey);

    expect(mocks.construct).toHaveBeenCalledWith({
      region: "us-east-2",
      credentials: {
        accessKeyId: "TEST_ONLY_ACCESS_KEY",
        secretAccessKey: "TEST_ONLY_SECRET",
      },
    });
    const [command] = mocks.send.mock.calls[0];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect(command.input).toEqual({
      Bucket: "test-private-video-bucket",
      Key: derivativeKey,
    });
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
  });

  it("keeps a legacy MP4 when ffprobe confirms H.264 yuv420p and AAC", async () => {
    configureMissingDerivative();
    mockProcessSuccess(probeJson());

    await expect(ensureCompatibleVideoKey(sourceKey)).resolves.toBe(sourceKey);

    expect(mocks.storageReadBytes).toHaveBeenCalledWith(sourceKey);
    expect(mocks.writeFile).toHaveBeenCalledWith(sourcePath, Buffer.from("private-original-video"));
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(mocks.execFile.mock.calls[0][0]).toBe("ffprobe");
    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith(tempDirectory, { recursive: true, force: true });
  });

  it("converts yuv444p input to verified yuv420p H.264 MP4 and stores only the derivative key", async () => {
    configureMissingDerivative();
    let probeCall = 0;
    mocks.execFile.mockImplementation(
      (file: string, _args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        if (file === "ffmpeg") {
          callback(null, "", "");
          return;
        }
        probeCall += 1;
        callback(null, probeCall === 1 ? probeJson({ pixelFormat: "yuv444p" }) : probeJson(), "");
      }
    );

    await expect(ensureCompatibleVideoKey(sourceKey)).resolves.toBe(derivativeKey);

    const ffmpegCall = mocks.execFile.mock.calls.find(([file]) => file === "ffmpeg");
    expect(ffmpegCall).toBeDefined();
    expect(ffmpegCall?.[1]).toEqual(expect.arrayContaining([
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-profile:v", "high",
      "-level:v", "4.1",
      "-c:a", "copy",
      "-movflags", "+faststart",
      outputPath,
    ]));
    expect(mocks.storagePut).toHaveBeenCalledWith(
      derivativeKey,
      Buffer.from("transcoded-private-bytes"),
      "video/mp4"
    );
    expect(mocks.rm).toHaveBeenCalledWith(tempDirectory, { recursive: true, force: true });
  });

  it("treats an S3 access denial as fatal rather than as a missing derivative", async () => {
    const denied = Object.assign(new Error("Access denied"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    });
    mocks.send.mockRejectedValue(denied);

    await expect(ensureCompatibleVideoKey(sourceKey)).rejects.toBe(denied);

    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(mocks.mkdtemp).not.toHaveBeenCalled();
  });

  it("accepts a genuine NoSuchKey absence and uses the private original instead", async () => {
    mocks.send.mockRejectedValue(Object.assign(new Error("No such key"), { name: "NoSuchKey" }));
    mockProcessSuccess(probeJson({ includeAudio: false }));

    await expect(ensureCompatibleVideoKey(sourceKey)).resolves.toBe(sourceKey);

    expect(mocks.storageReadBytes).toHaveBeenCalledWith(sourceKey);
  });

  it("removes temporary files when conversion fails", async () => {
    configureMissingDerivative();
    let call = 0;
    mocks.execFile.mockImplementation(
      (file: string, _args: readonly string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
        call += 1;
        if (file === "ffprobe" && call === 1) {
          callback(null, probeJson({ pixelFormat: "yuv444p" }), "");
          return;
        }
        callback(new Error("ffmpeg failed"), "", "conversion failed");
      }
    );

    await expect(ensureCompatibleVideoKey(sourceKey)).rejects.toThrow("ffmpeg failed");

    expect(mocks.storagePut).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith(tempDirectory, { recursive: true, force: true });
  });

  it("collapses concurrent calls for the same source key and clears the pending entry", async () => {
    configureMissingDerivative();
    let releaseRead!: (value: { key: string; data: Buffer }) => void;
    const deferredRead = new Promise<{ key: string; data: Buffer }>((resolve) => {
      releaseRead = resolve;
    });
    mocks.storageReadBytes.mockReturnValue(deferredRead);
    mockProcessSuccess(probeJson());

    const first = ensureCompatibleVideoKey(concurrentSourceKey);
    const second = ensureCompatibleVideoKey(concurrentSourceKey);

    expect(second).toBe(first);
    expect(mocks.send).toHaveBeenCalledOnce();

    releaseRead({ key: concurrentSourceKey, data: Buffer.from("private-original-video") });
    await expect(first).resolves.toBe(concurrentSourceKey);
    expect(mocks.storageReadBytes).toHaveBeenCalledOnce();

    await expect(ensureCompatibleVideoKey(concurrentSourceKey)).resolves.toBe(concurrentSourceKey);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
});

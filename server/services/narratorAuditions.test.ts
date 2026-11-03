import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  client: vi.fn(),
  destroy: vi.fn(),
  post: vi.fn(),
  sign: vi.fn(),
}));

// All external boundaries are replaced. Importing/running this file cannot contact AWS or ElevenLabs.
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(options: unknown) {
      mocks.client(options);
    }
    send(command: unknown, options: unknown) {
      return mocks.send(command, options);
    }
    destroy() {
      mocks.destroy();
    }
  },
  GetObjectCommand: class {
    readonly kind = "get";
    constructor(readonly input: unknown) {}
  },
  PutObjectCommand: class {
    readonly kind = "put";
    constructor(readonly input: unknown) {}
  },
}));
vi.mock("axios", () => ({ default: { post: mocks.post } }));
vi.mock("../storage", () => ({ storageGetSignedUrl: mocks.sign }));

import {
  NARRATOR_AUDITION_MODEL,
  NARRATOR_AUDITION_PRESETS,
  NARRATOR_AUDITION_SETTINGS,
  NARRATOR_AUDITION_TEXT,
  type NarratorAuditionId,
} from "@shared/narratorAuditions";
import {
  getNarratorAudition,
  NarratorAuditionError,
} from "./narratorAuditions";

type Input = {
  Bucket: string;
  Key: string;
  Body?: Buffer;
  ContentType?: string;
  IfMatch?: string;
  IfNoneMatch?: string;
  ACL?: string;
};
type Command = { kind: "get" | "put"; input: Input };
type Stored = {
  bytes: Buffer;
  contentType: string;
  etag?: string;
  contentLength?: number;
};
const objects = new Map<string, Stored>();
const NOW = 1_800_000_000_000;
const TOKEN = "11111111-1111-4111-8111-111111111111";
const OTHER_TOKEN = "22222222-2222-4222-8222-222222222222";
let revision = 0;
let now = NOW;
let intercept: ((command: Command) => Promise<unknown> | undefined) | undefined;
const address = (bucket: string, key: string) => JSON.stringify([bucket, key]);

function clipKey(id: NarratorAuditionId = "playful"): string {
  const preset = NARRATOR_AUDITION_PRESETS.find(value => value.id === id)!;
  const recipe = JSON.stringify({
    version: 1,
    id,
    voiceId: preset.voiceId,
    modelId: NARRATOR_AUDITION_MODEL,
    settings: NARRATOR_AUDITION_SETTINGS,
    text: NARRATOR_AUDITION_TEXT,
    outputFormat: "mp3_44100_128",
  });
  return `kidzrstarz/narrator-auditions/v1/${id}-${createHash("sha256").update(recipe).digest("hex")}.mp3`;
}
const leaseKey = () => `${clipKey()}.lease.json`;
const s3Error = (name: string, status?: number) =>
  Object.assign(new Error(`PRIVATE ${name}`), {
    name,
    $metadata: { httpStatusCode: status },
  });

// Two complete 128 kbps / 44.1 kHz MPEG-1 Layer III frames; no real customer/provider audio.
function audio(): Buffer {
  const frame = Buffer.alloc(417);
  Buffer.from([0xff, 0xfb, 0x90, 0xc0]).copy(frame);
  return Buffer.concat([frame, frame]);
}

function store(
  key: string,
  bytes: Buffer,
  contentType = "audio/mpeg",
  bucket = "offline-bucket"
): Stored {
  const value = { bytes, contentType, etag: `"revision-${++revision}"` };
  objects.set(address(bucket, key), value);
  return value;
}
function seedLease(expiresAt: number, token = TOKEN): Stored {
  return store(
    leaseKey(),
    Buffer.from(JSON.stringify({ version: 1, token, expiresAt })),
    "application/json"
  );
}
function leaseValue(): { token: string; expiresAt: number } {
  return JSON.parse(
    objects.get(address("offline-bucket", leaseKey()))!.bytes.toString()
  );
}
function puts(lease: boolean): Input[] {
  return mocks.send.mock.calls
    .map(([command]) => command as Command)
    .filter(
      command =>
        command.kind === "put" &&
        command.input.Key.endsWith(".lease.json") === lease
    )
    .map(command => command.input);
}

async function memoryS3(command: Command): Promise<unknown> {
  const { input } = command;
  const existing = objects.get(address(input.Bucket, input.Key));
  if (command.kind === "get") {
    if (!existing) throw s3Error("NoSuchKey", 404);
    return {
      Body: Readable.from([existing.bytes]),
      ContentType: existing.contentType,
      ContentLength: existing.contentLength ?? existing.bytes.length,
      ETag: existing.etag,
    };
  }
  if (input.IfNoneMatch === "*" && existing)
    throw s3Error("PreconditionFailed", 412);
  if (input.IfMatch && input.IfMatch !== existing?.etag)
    throw s3Error("PreconditionFailed", 412);
  const written = store(
    input.Key,
    Buffer.from(input.Body!),
    input.ContentType,
    input.Bucket
  );
  return { ETag: written.etag };
}

beforeEach(() => {
  vi.resetAllMocks();
  objects.clear();
  revision = 0;
  now = NOW;
  intercept = undefined;
  vi.stubEnv("S3_BUCKET", "offline-bucket");
  vi.stubEnv("S3_REGION", "offline-region");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "offline-access");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "offline-secret");
  vi.stubEnv("ELEVENLABS_API_KEY", "offline-provider-secret");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.send.mockImplementation(
    (command: Command) => intercept?.(command) ?? memoryS3(command)
  );
  mocks.post.mockResolvedValue({
    status: 200,
    headers: { "content-type": "audio/mpeg" },
    data: audio(),
  });
  mocks.sign.mockImplementation(async (key: string) => ({
    key,
    url: "https://signed.offline.invalid/clip?signature=mock",
  }));
});

afterEach(() => {
  expect(console.log).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  expect(console.error).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("fixed native narrator auditions (entirely offline)", () => {
  it.each(NARRATOR_AUDITION_PRESETS)(
    "uses only $name's immutable native recipe",
    async preset => {
      const result = await getNarratorAudition(preset.id);
      expect(result).toEqual({
        id: preset.id,
        name: preset.name,
        label: preset.label,
        modelId: "eleven_multilingual_v2",
        fromCache: false,
        url: "https://signed.offline.invalid/clip?signature=mock",
      });
      expect(mocks.post).toHaveBeenCalledOnce();
      expect(mocks.post).toHaveBeenCalledWith(
        `https://api.elevenlabs.io/v1/text-to-speech/${preset.voiceId}`,
        {
          text: NARRATOR_AUDITION_TEXT,
          model_id: NARRATOR_AUDITION_MODEL,
          voice_settings: NARRATOR_AUDITION_SETTINGS,
        },
        expect.objectContaining({
          responseType: "arraybuffer",
          params: { output_format: "mp3_44100_128" },
          timeout: 60_000,
          signal: expect.any(AbortSignal),
          maxContentLength: 2 * 1024 * 1024,
          maxBodyLength: 8192,
          maxRedirects: 0,
          headers: {
            "xi-api-key": "offline-provider-secret",
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
        })
      );
      expect(mocks.post.mock.calls[0][1]).not.toHaveProperty("language_code");
      expect(puts(false)).toEqual([
        expect.objectContaining({
          Key: clipKey(preset.id),
          ContentType: "audio/mpeg",
          IfNoneMatch: "*",
        }),
      ]);
      expect(puts(false)[0]).not.toHaveProperty("ACL");
      expect(mocks.sign).toHaveBeenCalledWith(clipKey(preset.id), 600);
      expect(mocks.client).toHaveBeenCalledWith({
        region: "offline-region",
        credentials: {
          accessKeyId: "offline-access",
          secretAccessKey: "offline-secret",
        },
        maxAttempts: 1,
      });
      for (const [, options] of mocks.send.mock.calls)
        expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(mocks.destroy).toHaveBeenCalledOnce();
    }
  );

  it("does not start work on import and rejects arbitrary IDs before any storage/provider access", async () => {
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
    await expect(
      getNarratorAudition("arbitrary-voice" as NarratorAuditionId)
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("checks valid cached bytes before billing, even without a provider key", async () => {
    store(clipKey(), audio(), "Audio/Mpeg; charset=binary");
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: true,
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(puts(true)).toHaveLength(0);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("reuses persisted audio on later calls and leaves an expired CAS marker instead of deleting", async () => {
    await getNarratorAudition("playful");
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: true,
    });
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(puts(true)).toHaveLength(2);
    expect(puts(true)[0].IfNoneMatch).toBe("*");
    expect(puts(true)[1].IfMatch).toBe('"revision-1"');
    expect(leaseValue().expiresAt).toBe(0);
    expect(puts(true)[1]).not.toHaveProperty("IfNoneMatch");
    expect(
      mocks.send.mock.calls.every(([command]) =>
        ["get", "put"].includes(command.kind)
      )
    ).toBe(true);
  });

  it("shares the same in-process Promise for simultaneous calls", async () => {
    const first = getNarratorAudition("playful");
    const second = getNarratorAudition("playful");
    expect(first).toBe(second);
    expect(await first).toEqual(await second);
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(puts(false)).toHaveLength(1);
  });

  it("isolates clips and in-process identity by configured bucket", async () => {
    await getNarratorAudition("playful");
    vi.stubEnv("S3_BUCKET", "other-offline-bucket");
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: false,
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(puts(false).map(input => input.Bucket)).toEqual([
      "offline-bucket",
      "other-offline-bucket",
    ]);
    expect(objects.has(address("offline-bucket", clipKey()))).toBe(true);
    expect(objects.has(address("other-offline-bucket", clipKey()))).toBe(true);
  });

  it.each([
    s3Error("AccessDenied", 403),
    s3Error("NoSuchBucket", 404),
    Object.assign(new Error("bare status"), {
      $metadata: { httpStatusCode: 404 },
    }),
    s3Error("AbortError"),
  ])(
    "does not treat a cache permission/bucket/transport failure as absence: %s",
    async error => {
      mocks.send.mockRejectedValue(error);
      await expect(getNarratorAudition("playful")).rejects.toMatchObject({
        name: "NarratorAuditionError",
        code: "STORAGE",
      });
      expect(mocks.post).not.toHaveBeenCalled();
      expect(puts(true)).toHaveLength(0);
    }
  );

  it.each(["NoSuchKey", "NotFound"])(
    "accepts only explicit object absence (%s)",
    async name => {
      let first = true;
      intercept = command => {
        if (first && command.kind === "get") {
          first = false;
          return Promise.reject({ Code: name });
        }
      };
      await expect(getNarratorAudition("playful")).resolves.toMatchObject({
        fromCache: false,
      });
      expect(mocks.post).toHaveBeenCalledOnce();
    }
  );

  it.each([
    [Buffer.alloc(0), "audio/mpeg"],
    [Buffer.from("ID3\x04\0\0\0\0\0\0"), "audio/mpeg"],
    [Buffer.from('{"error":"not audio"}'), "audio/mpeg"],
    [audio(), "application/json"],
    [Buffer.from("RIFF fake wav"), "audio/wav"],
    [Buffer.alloc(2 * 1024 * 1024 + 1), "audio/mpeg"],
    [audio().subarray(0, 700), "audio/mpeg"],
    [Buffer.concat([audio(), Buffer.from("junk")]), "audio/mpeg"],
  ])(
    "rejects invalid provider audio without upload/fallback",
    async (data, contentType) => {
      mocks.post.mockResolvedValue({
        status: 200,
        headers: { "content-type": contentType },
        data,
      });
      await expect(getNarratorAudition("playful")).rejects.toMatchObject({
        code: "INVALID_AUDIO",
      });
      expect(mocks.post).toHaveBeenCalledOnce();
      expect(puts(false)).toHaveLength(0);
      expect(mocks.sign).not.toHaveBeenCalled();
      expect(leaseValue().expiresAt).toBe(0);
    }
  );

  it("rejects corrupt cached audio rather than paying to repair it", async () => {
    store(clipKey(), Buffer.from("ID3 not a playable mp3"));
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "INVALID_AUDIO",
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(puts(true)).toHaveLength(0);
  });

  it("bounds streamed cache bytes even if ContentLength is misleading", async () => {
    const value = store(clipKey(), Buffer.alloc(2 * 1024 * 1024 + 1));
    value.contentLength = 1;
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "STORAGE",
    });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("accepts ID3 metadata only when followed by complete audio frames", async () => {
    const tag = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 3, 1, 2, 3]);
    mocks.post.mockResolvedValue({
      status: 200,
      headers: { "content-type": "audio/mpeg" },
      data: Buffer.concat([tag, audio()]),
    });
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: false,
    });
  });

  it("does not leak provider credentials/payloads and clears failed in-process promises", async () => {
    mocks.post.mockRejectedValueOnce(
      Object.assign(new Error("offline-provider-secret RAW RESPONSE"), {
        config: { headers: { "xi-api-key": "offline-provider-secret" } },
        response: { data: "provider account info" },
      })
    );
    const failure = await getNarratorAudition("playful").catch(error => error);
    expect(failure).toBeInstanceOf(NarratorAuditionError);
    expect(failure.code).toBe("UNAVAILABLE");
    expect(JSON.stringify(failure)).not.toMatch(/secret|RAW|account info/);
    expect(failure.message).not.toMatch(/secret|RAW|account info/);
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: false,
    });
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});

describe("conditional lease ownership and bounded failures", () => {
  it.each([NOW + 300_000, NOW, NOW - 4_999])(
    "never takes over a live or insufficiently expired lease (%s)",
    async expiresAt => {
      seedLease(expiresAt);
      await expect(getNarratorAudition("playful")).rejects.toMatchObject({
        code: "BUSY",
      });
      expect(mocks.post).not.toHaveBeenCalled();
      expect(puts(true)).toHaveLength(1);
      expect(leaseValue().token).toBe(TOKEN);
    }
  );

  it("takes over a genuinely expired token only by the read ETag", async () => {
    const old = seedLease(NOW - 6_000);
    await getNarratorAudition("playful");
    expect(puts(true)).toHaveLength(3);
    expect(puts(true)[1].IfMatch).toBe(old.etag);
    const replacement = JSON.parse(puts(true)[1].Body!.toString());
    expect(replacement.token).not.toBe(TOKEN);
    expect(replacement.expiresAt).toBe(NOW + 300_000);
    expect(puts(true)[2].IfMatch).not.toBe(old.etag);
    expect(leaseValue().token).toBe(replacement.token);
    expect(leaseValue().expiresAt).toBe(0);
  });

  it("losing the expired-lease CAS returns BUSY without looping or generating", async () => {
    seedLease(NOW - 6_000);
    intercept = command => {
      if (command.kind === "put" && command.input.IfMatch)
        return Promise.reject(s3Error("ConditionalRequestConflict", 409));
    };
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(puts(true)).toHaveLength(2);
    expect(mocks.send).toHaveBeenCalledTimes(4);
  });

  it("a vanished lease after first conditional conflict is BUSY, not an unconditional takeover", async () => {
    intercept = command => {
      if (command.kind === "put")
        return Promise.reject(s3Error("PreconditionFailed", 412));
    };
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each([s3Error("AccessDenied", 403), s3Error("AbortError")])(
    "lease acquisition failure cannot bill (%s)",
    async error => {
      intercept = command =>
        command.kind === "put" ? Promise.reject(error) : undefined;
      await expect(getNarratorAudition("playful")).rejects.toMatchObject({
        code: "STORAGE",
      });
      expect(mocks.post).not.toHaveBeenCalled();
      expect(puts(true)).toHaveLength(1);
    }
  );

  it.each([
    "bad JSON",
    JSON.stringify({ version: 1, token: "wrong", expiresAt: 0 }),
    "x".repeat(1025),
  ])("malformed leases are never expired leases", async raw => {
    store(leaseKey(), Buffer.from(raw), "application/json");
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "STORAGE",
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(puts(true)).toHaveLength(1);
  });

  it("missing acquired ETag blocks billing and does not perform unsafe cleanup", async () => {
    intercept = command => {
      if (command.kind === "put") return memoryS3(command).then(() => ({}));
    };
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "STORAGE",
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(puts(true)).toHaveLength(1);
    expect(leaseValue().expiresAt).toBeGreaterThan(NOW);
  });

  it("checks the cache again after acquiring the lease", async () => {
    intercept = command => {
      if (
        command.kind === "put" &&
        command.input.IfNoneMatch &&
        command.input.Key.endsWith(".lease.json")
      ) {
        return memoryS3(command).then(result => {
          store(clipKey(), audio());
          return result;
        });
      }
    };
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: true,
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(leaseValue().expiresAt).toBe(0);
  });

  it("verifies token/ETag ownership before the paid call", async () => {
    intercept = command => {
      if (command.kind === "put" && command.input.IfNoneMatch) {
        return memoryS3(command).then(result => {
          seedLease(NOW + 300_000, OTHER_TOKEN);
          return result;
        });
      }
    };
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(leaseValue().token).toBe(OTHER_TOKEN);
    expect(leaseValue().expiresAt).toBeGreaterThan(NOW);
  });

  it("a former owner cannot commit audio or expire a replacement owner", async () => {
    mocks.post.mockImplementation(async () => {
      seedLease(NOW + 300_000, OTHER_TOKEN);
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
        data: audio(),
      };
    });
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(puts(false)).toHaveLength(0);
    expect(leaseValue().token).toBe(OTHER_TOKEN);
    expect(leaseValue().expiresAt).toBeGreaterThan(NOW);
  });

  it("does not commit when its lease expires while awaiting the provider", async () => {
    mocks.post.mockImplementation(async () => {
      now += 300_001;
      return {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
        data: audio(),
      };
    });
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(puts(false)).toHaveLength(0);
    expect(leaseValue().expiresAt).toBe(0);
  });

  it("does not overwrite audio created by a competitor on conditional upload conflict", async () => {
    const competingAudio = Buffer.concat([audio(), audio()]);
    intercept = command => {
      if (
        command.kind === "put" &&
        !command.input.Key.endsWith(".lease.json")
      ) {
        store(clipKey(), competingAudio);
        return Promise.reject(s3Error("PreconditionFailed", 412));
      }
    };
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: true,
    });
    expect(objects.get(address("offline-bucket", clipKey()))!.bytes).toEqual(
      competingAudio
    );
  });

  it("upload failure is STORAGE and performs owned conditional cleanup", async () => {
    intercept = command =>
      command.kind === "put" && !command.input.Key.endsWith(".lease.json")
        ? Promise.reject(s3Error("AccessDenied", 403))
        : undefined;
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "STORAGE",
    });
    expect(leaseValue().expiresAt).toBe(0);
  });

  it("cleanup failure surfaces safely, but the durable cache is reused on retry", async () => {
    intercept = command => {
      if (
        command.kind === "put" &&
        command.input.Key.endsWith(".lease.json") &&
        command.input.IfMatch
      )
        return Promise.reject(s3Error("AccessDenied", 403));
    };
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "STORAGE",
    });
    await expect(getNarratorAudition("playful")).resolves.toMatchObject({
      fromCache: true,
    });
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("cleanup failure does not mask a provider failure", async () => {
    mocks.post.mockRejectedValue(new Error("SECRET quota response"));
    intercept = command =>
      command.kind === "put" && command.input.IfMatch
        ? Promise.reject(s3Error("AccessDenied", 403))
        : undefined;
    await expect(getNarratorAudition("playful")).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it("aborts a stalled S3 request at 30 seconds rather than billing or retrying", async () => {
    vi.useFakeTimers();
    mocks.send.mockImplementation(
      (_command, { abortSignal }) =>
        new Promise((_, reject) => {
          abortSignal.addEventListener(
            "abort",
            () => reject(s3Error("AbortError")),
            { once: true }
          );
        })
    );
    // Node's AbortSignal.timeout uses native timers, so control this boundary explicitly in the mock.
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    const outcome = expect(
      getNarratorAudition("playful")
    ).rejects.toMatchObject({ code: "STORAGE" });
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("aborts a stalled audio upload at 30 seconds while its lease is still live", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation(milliseconds => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), milliseconds);
      return controller.signal;
    });
    mocks.send.mockImplementation((command: Command, { abortSignal }) => {
      if (
        command.kind === "put" &&
        !command.input.Key.endsWith(".lease.json")
      ) {
        return new Promise((_, reject) => {
          abortSignal.addEventListener(
            "abort",
            () => reject(s3Error("AbortError")),
            { once: true }
          );
        });
      }
      return memoryS3(command);
    });
    const outcome = expect(
      getNarratorAudition("playful")
    ).rejects.toMatchObject({ code: "STORAGE" });
    await vi.advanceTimersByTimeAsync(0);
    expect(puts(false)).toHaveLength(1);
    expect(leaseValue().expiresAt).toBe(NOW + 300_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(puts(false)).toHaveLength(1);
    expect(objects.has(address("offline-bucket", clipKey()))).toBe(false);
    expect(leaseValue().expiresAt).toBe(0);
  });
});

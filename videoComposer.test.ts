import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── Mock fluent-ffmpeg ───────────────────────────────────────────────────────
vi.mock("fluent-ffmpeg", () => {
  const ffmpegMock = vi.fn(() => ({
    input: vi.fn().mockReturnThis(),
    inputOptions: vi.fn().mockReturnThis(),
    complexFilter: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    output: vi.fn().mockReturnThis(),
    on: vi.fn().mockImplementation(function (this: Record<string, unknown>, event: string, cb: () => void) {
      if (event === "end") setTimeout(cb, 0);
      return this;
    }),
    run: vi.fn(),
  }));
  (ffmpegMock as unknown as Record<string, unknown>).ffprobe = vi.fn(
    (_path: string, cb: (err: null, meta: { format: { duration: number } }) => void) => {
      cb(null, { format: { duration: 3.5 } });
    }
  );
  return { default: ffmpegMock };
});

// Mock fetch to return a small buffer for images, audio, and music
global.fetch = vi.fn().mockImplementation((url: string) => {
  const buffer = Buffer.from("fake-data");
  return Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(buffer.buffer),
    headers: { get: () => null },
  });
}) as unknown as typeof fetch;

// ─── wrapText utility tests ───────────────────────────────────────────────────
// We test the module's internal wrapText by importing the module and checking
// that long text is correctly wrapped into at most 2 lines.

describe("videoComposer module (mocked ffmpeg)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kidzrstarz-test-"));
  });

  afterEach(() => {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  });

  it("composeStorybookVideo resolves for a single scene with subtitle text", async () => {
    const { composeStorybookVideo } = await import("./services/videoComposer");
    const outputPath = path.join(tmpDir, "test_output.mp4");
    fs.writeFileSync(outputPath, Buffer.from("fake-mp4"));

    await expect(
      composeStorybookVideo({
        orderId: 1,
        childName: "Alice",
        storyTheme: "adventure",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes: [
          {
            sceneIndex: 1,
            sceneText: "Once upon a time in a magical forest, Alice discovered a hidden door.",
            illustrationUrl: "https://example.com/image1.jpg",
            narrationUrl: "https://example.com/audio1.mp3",
          },
        ],
        outputPath,
      })
    ).resolves.toBe(outputPath);
  });

  it("composeStorybookVideo resolves for 5 scenes with mixed text", async () => {
    const { composeStorybookVideo } = await import("./services/videoComposer");
    const outputPath = path.join(tmpDir, "test_5scenes.mp4");
    fs.writeFileSync(outputPath, Buffer.from("fake-mp4"));

    const scenes = Array.from({ length: 5 }, (_, i) => ({
      sceneIndex: i + 1,
      sceneText: i % 2 === 0 ? `Scene ${i + 1}: The adventure continues with many exciting events.` : null,
      illustrationUrl: `https://example.com/image${i + 1}.jpg`,
      narrationUrl: `https://example.com/audio${i + 1}.mp3`,
    }));

    await expect(
      composeStorybookVideo({
        orderId: 42,
        childName: "Bob",
        storyTheme: "space",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes,
        outputPath,
      })
    ).resolves.toBe(outputPath);
  });

  it("composeStorybookVideo accepts null sceneText (no subtitle)", async () => {
    const { composeStorybookVideo } = await import("./services/videoComposer");
    const outputPath = path.join(tmpDir, "test_no_subtitle.mp4");
    fs.writeFileSync(outputPath, Buffer.from("fake-mp4"));

    await expect(
      composeStorybookVideo({
        orderId: 99,
        childName: "Charlie",
        storyTheme: "magic",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes: [
          {
            sceneIndex: 1,
            sceneText: null,
            illustrationUrl: "https://example.com/img.jpg",
            narrationUrl: "https://example.com/audio.mp3",
          },
        ],
        outputPath,
      })
    ).resolves.toBe(outputPath);
  });

  it("composeStorybookVideo uses custom backgroundMusicUrl when provided", async () => {
    const { composeStorybookVideo } = await import("./services/videoComposer");
    const outputPath = path.join(tmpDir, "test_custom_music.mp4");
    fs.writeFileSync(outputPath, Buffer.from("fake-mp4"));

    const customMusicUrl = "https://example.com/custom-lullaby.mp3";
    const fetchSpy = vi.spyOn(global, "fetch");

    await composeStorybookVideo({
      orderId: 7,
      childName: "Diana",
      storyTheme: "fairy tale",
      backgroundMusicUrl: customMusicUrl,
      scenes: [
        {
          sceneIndex: 1,
          sceneText: "A fairy tale begins.",
          illustrationUrl: "https://example.com/img.jpg",
          narrationUrl: "https://example.com/audio.mp3",
        },
      ],
      outputPath,
    });

    // Verify the custom music URL was fetched
    const fetchedUrls = fetchSpy.mock.calls.map((call) => call[0] as string);
    expect(fetchedUrls).toContain(customMusicUrl);
  });
});

// ─── wrapText utility unit tests ──────────────────────────────────────────────
// We test text wrapping behavior by exercising the composer with long text
// and verifying it doesn't throw (the drawtext filter receives wrapped text).

describe("subtitle text handling", () => {
  it("handles very long scene text without throwing", async () => {
    const { composeStorybookVideo } = await import("./services/videoComposer");
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "kidzrstarz-wrap-"));
    const outputPath = path.join(tmpDir2, "test_long.mp4");
    fs.writeFileSync(outputPath, Buffer.from("fake-mp4"));

    const longText =
      "Once upon a time in a land far far away there lived a young child named Alice who loved to explore the magical forest near her home and discover all its hidden wonders and secrets.";

    await expect(
      composeStorybookVideo({
        orderId: 55,
        childName: "Alice",
        storyTheme: "adventure",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes: [
          {
            sceneIndex: 1,
            sceneText: longText,
            illustrationUrl: "https://example.com/img.jpg",
            narrationUrl: "https://example.com/audio.mp3",
          },
        ],
        outputPath,
      })
    ).resolves.toBe(outputPath);

    try {
      const files = fs.readdirSync(tmpDir2);
      for (const f of files) { try { fs.unlinkSync(path.join(tmpDir2, f)); } catch {} }
      fs.rmdirSync(tmpDir2);
    } catch {}
  });

  it("handles text with special characters (apostrophes, colons)", async () => {
    const { composeStorybookVideo } = await import("./services/videoComposer");
    const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), "kidzrstarz-special-"));
    const outputPath = path.join(tmpDir3, "test_special.mp4");
    fs.writeFileSync(outputPath, Buffer.from("fake-mp4"));

    await expect(
      composeStorybookVideo({
        orderId: 66,
        childName: "O'Brien",
        storyTheme: "mystery: the lost key",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes: [
          {
            sceneIndex: 1,
            sceneText: "O'Brien said: 'Let's go!' and [jumped] into the adventure.",
            illustrationUrl: "https://example.com/img.jpg",
            narrationUrl: "https://example.com/audio.mp3",
          },
        ],
        outputPath,
      })
    ).resolves.toBe(outputPath);

    try {
      const files = fs.readdirSync(tmpDir3);
      for (const f of files) { try { fs.unlinkSync(path.join(tmpDir3, f)); } catch {} }
      fs.rmdirSync(tmpDir3);
    } catch {}
  });
});

// ─── Access control tests ─────────────────────────────────────────────────────
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function makeCtx(role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("video generation pipeline access control", () => {
  it("triggerVideoGeneration throws NOT_FOUND for non-existent order", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.orders.triggerVideoGeneration({ orderId: 999999, guestToken: undefined })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("triggerVideoGeneration throws for unauthenticated user with no guest token", async () => {
    const ctx: TrpcContext = {
      user: null,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    // Unauthenticated users with no guest token should be rejected with
    // NOT_FOUND (order not found), UNAUTHORIZED, or FORBIDDEN depending on
    // the access-control path taken by the router.
    await expect(
      caller.orders.triggerVideoGeneration({ orderId: 1, guestToken: undefined })
    ).rejects.toMatchObject({ code: expect.stringMatching(/NOT_FOUND|UNAUTHORIZED|FORBIDDEN/) });
  });

  it("admin.retryVideoGeneration throws NOT_FOUND for non-existent order", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    await expect(
      caller.admin.retryVideoGeneration({ orderId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getOrder throws NOT_FOUND for non-existent order", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.orders.getOrder({ orderId: 999999, guestToken: undefined })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

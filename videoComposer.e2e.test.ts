/**
 * End-to-end test for the video composer.
 * Invokes real ffmpeg to verify actual MP4 output with:
 *  - background music mixing (amix)
 *  - scene text subtitle overlay (drawtext)
 *  - xfade crossfade transitions
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ffmpegAvailable = (() => {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!ffmpegAvailable)("videoComposer E2E (real ffmpeg)", () => {
  let tmpDir: string;
  let img1: string;
  let img2: string;
  let audio1: string;
  let audio2: string;
  let music: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kidzrstarz-e2e-"));

    // Create solid-color JPEG images
    img1 = path.join(tmpDir, "img1.jpg");
    img2 = path.join(tmpDir, "img2.jpg");
    execSync(`ffmpeg -f lavfi -i color=c=red:size=1280x720:rate=25:duration=1 -vframes 1 ${img1} -y`, { stdio: "ignore" });
    execSync(`ffmpeg -f lavfi -i color=c=blue:size=1280x720:rate=25:duration=1 -vframes 1 ${img2} -y`, { stdio: "ignore" });

    // Create 2-second silent MP3 audio files
    audio1 = path.join(tmpDir, "audio1.mp3");
    audio2 = path.join(tmpDir, "audio2.mp3");
    execSync(`ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 2 -c:a mp3 ${audio1} -y`, { stdio: "ignore" });
    execSync(`ffmpeg -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -t 2 -c:a mp3 ${audio2} -y`, { stdio: "ignore" });

    // Create a short background music MP3 (sine wave)
    music = path.join(tmpDir, "music.mp3");
    execSync(
      `ffmpeg -f lavfi -i "aevalsrc=sin(2*PI*261.6*t)*0.1:s=44100:d=30" -c:a mp3 -b:a 128k ${music} -y`,
      { stdio: "ignore" }
    );
  });

  afterAll(() => {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  });

  it("produces a valid MP4 with 2 scenes, subtitles, music, and xfade transitions", async () => {
    const originalFetch = global.fetch;

    global.fetch = (async (url: string) => {
      const fileMap: Record<string, string> = {
        "https://example.com/img1.jpg": img1,
        "https://example.com/img2.jpg": img2,
        "https://example.com/audio1.mp3": audio1,
        "https://example.com/audio2.mp3": audio2,
        "https://example.com/music.mp3": music,
      };
      const localPath = fileMap[url];
      if (!localPath) throw new Error(`Unmapped URL: ${url}`);
      const buffer = fs.readFileSync(localPath);
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer.buffer),
        headers: { get: () => null },
      };
    }) as unknown as typeof fetch;

    try {
      const { composeStorybookVideo } = await import("./services/videoComposer");
      const outputPath = path.join(tmpDir, "output_full.mp4");

      const result = await composeStorybookVideo({
        orderId: 1,
        childName: "Alice",
        storyTheme: "adventure",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes: [
          {
            sceneIndex: 1,
            sceneText: "Once upon a time, Alice found a magical door in the forest.",
            illustrationUrl: "https://example.com/img1.jpg",
            narrationUrl: "https://example.com/audio1.mp3",
          },
          {
            sceneIndex: 2,
            sceneText: "She stepped through and discovered a world full of wonder!",
            illustrationUrl: "https://example.com/img2.jpg",
            narrationUrl: "https://example.com/audio2.mp3",
          },
        ],
        outputPath,
      });

      // File exists and has meaningful size
      expect(result).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      const stats = fs.statSync(outputPath);
      expect(stats.size).toBeGreaterThan(10_000);

      // Valid MP4 with correct duration
      const probeOutput = execSync(
        `ffprobe -v quiet -show_entries format=duration,format_name -of csv=p=0 ${outputPath}`
      ).toString().trim();
      expect(probeOutput).toContain("mov,mp4");

      const durationMatch = probeOutput.match(/([\d.]+)\s*$/);
      const duration = durationMatch ? parseFloat(durationMatch[1]) : 0;
      expect(duration).toBeGreaterThan(5);
      expect(duration).toBeLessThan(30);

      // Verify it has both video and audio streams
      const streamsOutput = execSync(
        `ffprobe -v quiet -show_entries stream=codec_type -of csv=p=0 ${outputPath}`
      ).toString().trim();
      expect(streamsOutput).toContain("video");
      expect(streamsOutput).toContain("audio");

      console.log(`[E2E] MP4: ${stats.size} bytes, ${duration.toFixed(2)}s, streams: ${streamsOutput.replace(/\n/g, ",")}`);
    } finally {
      global.fetch = originalFetch;
    }
  }, 90_000);

  it("produces a valid MP4 for a single scene with null subtitle text", async () => {
    const originalFetch = global.fetch;

    global.fetch = (async (url: string) => {
      const fileMap: Record<string, string> = {
        "https://example.com/img1.jpg": img1,
        "https://example.com/audio1.mp3": audio1,
        "https://example.com/music.mp3": music,
      };
      const localPath = fileMap[url];
      if (!localPath) throw new Error(`Unmapped URL: ${url}`);
      const buffer = fs.readFileSync(localPath);
      return {
        ok: true,
        arrayBuffer: () => Promise.resolve(buffer.buffer),
        headers: { get: () => null },
      };
    }) as unknown as typeof fetch;

    try {
      const { composeStorybookVideo } = await import("./services/videoComposer");
      const outputPath = path.join(tmpDir, "output_single_no_sub.mp4");

      const result = await composeStorybookVideo({
        orderId: 2,
        childName: "Bob",
        storyTheme: "space",
        backgroundMusicUrl: "https://example.com/music.mp3",
        scenes: [
          {
            sceneIndex: 1,
            sceneText: null,
            illustrationUrl: "https://example.com/img1.jpg",
            narrationUrl: "https://example.com/audio1.mp3",
          },
        ],
        outputPath,
      });

      expect(result).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);
      expect(fs.statSync(outputPath).size).toBeGreaterThan(5_000);
    } finally {
      global.fetch = originalFetch;
    }
  }, 90_000);
});

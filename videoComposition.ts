import { exec, execSync } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import * as path from "path";
import * as os from "os";
import * as https from "https";
import * as http from "http";
import { createRequire } from "module";

const execAsync = promisify(exec);

/**
 * Directory where auto-downloaded ffmpeg binaries are cached.
 * Uses a persistent location so it survives server restarts.
 */
const FFMPEG_CACHE_DIR = path.join(os.homedir(), ".ffmpeg-cache");

/**
 * Static ffmpeg binary URLs from shaka-project/static-ffmpeg-binaries (GitHub).
 * These are standalone executables — no archive extraction needed.
 * GPL builds with libx264 included (required for H.264 encoding).
 * ~48MB per binary, much smaller than BtbN tar.xz archives (~134MB).
 */
const FFMPEG_BINARY_URLS: Record<string, { ffmpeg: string; ffprobe: string }> = {
  "x64": {
    ffmpeg: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.0.1-1/ffmpeg-linux-x64",
    ffprobe: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.0.1-1/ffprobe-linux-x64",
  },
  "arm64": {
    ffmpeg: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.0.1-1/ffmpeg-linux-arm64",
    ffprobe: "https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/n8.0.1-1/ffprobe-linux-arm64",
  },
};

/**
 * Download a large file using Node.js built-in https/http modules with streaming.
 * Handles GitHub redirects (302 → CDN). No curl/wget needed.
 */
function downloadLargeFile(url: string, destPath: string, maxRedirects = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const doRequest = (requestUrl: string, redirectsLeft: number) => {
      const lib = requestUrl.startsWith("https") ? https : http;
      lib.get(requestUrl, (res) => {
        // Handle redirects (GitHub returns 302 to CDN)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          if (redirectsLeft <= 0) {
            reject(new Error(`Too many redirects for ${url}`));
            return;
          }
          doRequest(res.headers.location, redirectsLeft - 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download ${url}: HTTP ${res.statusCode}`));
          return;
        }

        const fileStream = createWriteStream(destPath);
        let downloaded = 0;
        const totalSize = parseInt(res.headers["content-length"] || "0", 10);

        res.on("data", (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalSize > 0 && downloaded % (5 * 1024 * 1024) < chunk.length) {
            const pct = ((downloaded / totalSize) * 100).toFixed(0);
            console.log(`[VideoCompose] Download progress: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)}MB / ${(totalSize / 1024 / 1024).toFixed(1)}MB)`);
          }
        });

        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close();
          console.log(`[VideoCompose] Downloaded ${(downloaded / 1024 / 1024).toFixed(1)}MB to ${destPath}`);
          resolve();
        });
        fileStream.on("error", (err) => {
          fs.rm(destPath, { force: true }).catch(() => {});
          reject(err);
        });
      }).on("error", (err) => {
        reject(new Error(`Network error downloading ${url}: ${err.message}`));
      });
    };

    // Set a 5-minute overall timeout
    const timeout = setTimeout(() => {
      reject(new Error(`Download timed out after 5 minutes: ${url}`));
    }, 300000);

    doRequest(url, maxRedirects);

    // Clear timeout on completion
    const origResolve = resolve;
    const origReject = reject;
    resolve = ((val: void) => { clearTimeout(timeout); origResolve(val); }) as any;
    reject = ((err: any) => { clearTimeout(timeout); origReject(err); }) as any;
  });
}

/**
 * Download standalone ffmpeg/ffprobe binaries from shaka-project.
 * No archive extraction needed — just download and chmod +x.
 */
async function downloadStaticFFmpeg(): Promise<{ ffmpeg: string; ffprobe: string }> {
  const arch = os.arch(); // 'x64', 'arm64', etc.
  const urls = FFMPEG_BINARY_URLS[arch];

  if (!urls) {
    throw new Error(`[VideoCompose] No static ffmpeg build available for architecture: ${arch}`);
  }

  // Create cache directory
  await fs.mkdir(FFMPEG_CACHE_DIR, { recursive: true });

  const ffmpegBin = path.join(FFMPEG_CACHE_DIR, "ffmpeg");
  const ffprobeBin = path.join(FFMPEG_CACHE_DIR, "ffprobe");

  // Check if already downloaded and working
  try {
    await fs.access(ffmpegBin);
    await fs.access(ffprobeBin);
    execSync(`"${ffmpegBin}" -version`, { encoding: "utf8", timeout: 5000 });
    execSync(`"${ffprobeBin}" -version`, { encoding: "utf8", timeout: 5000 });
    console.log(`[VideoCompose] Using cached static ffmpeg: ${ffmpegBin}`);
    return { ffmpeg: ffmpegBin, ffprobe: ffprobeBin };
  } catch {
    console.log(`[VideoCompose] Cached binaries not found or broken, downloading fresh...`);
  }

  console.log(`[VideoCompose] Downloading static ffmpeg for ${arch}...`);
  console.log(`[VideoCompose] This is a one-time download (~48MB per binary). Future runs will use the cached binary.`);

  try {
    // Download ffmpeg binary directly using Node.js (no curl/wget needed)
    console.log(`[VideoCompose] Downloading ffmpeg from ${urls.ffmpeg}...`);
    await downloadLargeFile(urls.ffmpeg, ffmpegBin);

    // Download ffprobe binary directly
    console.log(`[VideoCompose] Downloading ffprobe from ${urls.ffprobe}...`);
    await downloadLargeFile(urls.ffprobe, ffprobeBin);

    // Make executable
    await fs.chmod(ffmpegBin, 0o755);
    await fs.chmod(ffprobeBin, 0o755);

    // Verify they work
    const ffmpegVersion = execSync(`"${ffmpegBin}" -version`, { encoding: "utf8", timeout: 5000 });
    execSync(`"${ffprobeBin}" -version`, { encoding: "utf8", timeout: 5000 });

    // Verify libx264 is available
    const encoders = execSync(`"${ffmpegBin}" -encoders 2>&1`, { encoding: "utf8", timeout: 5000 });
    if (!encoders.includes("libx264")) {
      throw new Error("Downloaded ffmpeg binary does not include libx264 encoder");
    }

    console.log(`[VideoCompose] Static ffmpeg installed successfully at ${ffmpegBin}`);
    console.log(`[VideoCompose] Version: ${ffmpegVersion.split("\n")[0]}`);

    return { ffmpeg: ffmpegBin, ffprobe: ffprobeBin };
  } catch (err) {
    // Clean up on failure
    await fs.rm(ffmpegBin, { force: true }).catch(() => {});
    await fs.rm(ffprobeBin, { force: true }).catch(() => {});
    throw new Error(`[VideoCompose] Failed to download static ffmpeg: ${err}`);
  }
}

/**
 * Resolve ffmpeg and ffprobe binary paths.
 * Strategy:
 *   1. Try system-installed ffmpeg/ffprobe (available on many Linux servers)
 *   2. Fall back to ffmpeg-static/ffprobe-static npm packages
 *   3. Try common paths
 *   4. Auto-download a static ffmpeg binary from GitHub
 */
function resolveFFmpegPathsSync(): { ffmpeg: string; ffprobe: string } | null {
  // Strategy 1: Try system ffmpeg
  try {
    const systemFfmpeg = execSync("which ffmpeg 2>/dev/null", { encoding: "utf8" }).trim();
    const systemFfprobe = execSync("which ffprobe 2>/dev/null", { encoding: "utf8" }).trim();
    if (systemFfmpeg && systemFfprobe) {
      execSync(`"${systemFfmpeg}" -version`, { encoding: "utf8", timeout: 5000 });
      execSync(`"${systemFfprobe}" -version`, { encoding: "utf8", timeout: 5000 });
      console.log(`[VideoCompose] Using system ffmpeg: ${systemFfmpeg}`);
      console.log(`[VideoCompose] Using system ffprobe: ${systemFfprobe}`);
      return { ffmpeg: systemFfmpeg, ffprobe: systemFfprobe };
    }
  } catch {
    console.log("[VideoCompose] System ffmpeg not available, trying ffmpeg-static...");
  }

  // Strategy 2: Try ffmpeg-static npm packages
  try {
    const require_ = createRequire(__filename || process.cwd() + "/dummy.js");
    const staticFfmpeg = require_("ffmpeg-static") as string;
    const staticFfprobe = (require_("ffprobe-static") as { path: string }).path;

    if (staticFfmpeg && staticFfprobe) {
      try {
        execSync(`"${staticFfmpeg}" -version`, { encoding: "utf8", timeout: 5000 });
        execSync(`"${staticFfprobe}" -version`, { encoding: "utf8", timeout: 5000 });
        console.log(`[VideoCompose] Using ffmpeg-static: ${staticFfmpeg}`);
        console.log(`[VideoCompose] Using ffprobe-static: ${staticFfprobe}`);
        return { ffmpeg: staticFfmpeg, ffprobe: staticFfprobe };
      } catch (verifyErr) {
        console.warn(`[VideoCompose] ffmpeg-static binary exists but failed to execute:`, verifyErr);
      }
    }
  } catch (err) {
    console.warn("[VideoCompose] ffmpeg-static package not available:", err);
  }

  // Strategy 3: Try common paths
  const commonPaths = ["/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/bin/ffmpeg"];
  for (const p of commonPaths) {
    try {
      execSync(`"${p}" -version`, { encoding: "utf8", timeout: 5000 });
      const probePath = p.replace("ffmpeg", "ffprobe");
      console.log(`[VideoCompose] Using ffmpeg at common path: ${p}`);
      return { ffmpeg: p, ffprobe: probePath };
    } catch {
      // continue
    }
  }

  // Strategy 4: Check if we have a cached auto-downloaded binary
  try {
    const ffmpegBin = path.join(FFMPEG_CACHE_DIR, "ffmpeg");
    const ffprobeBin = path.join(FFMPEG_CACHE_DIR, "ffprobe");
    execSync(`"${ffmpegBin}" -version`, { encoding: "utf8", timeout: 5000 });
    execSync(`"${ffprobeBin}" -version`, { encoding: "utf8", timeout: 5000 });
    console.log(`[VideoCompose] Using cached auto-downloaded ffmpeg: ${ffmpegBin}`);
    return { ffmpeg: ffmpegBin, ffprobe: ffprobeBin };
  } catch {
    // Not cached yet
  }

  return null; // Will need async download
}

/**
 * Full resolution including async download as last resort.
 */
async function resolveFFmpegPathsAsync(): Promise<{ ffmpeg: string; ffprobe: string }> {
  // Try sync strategies first
  const syncResult = resolveFFmpegPathsSync();
  if (syncResult) return syncResult;

  // Strategy 5: Auto-download static binary
  console.log("[VideoCompose] No ffmpeg found locally. Auto-downloading static binary...");
  return await downloadStaticFFmpeg();
}

// Resolve paths at module load time (sync strategies only)
let FFMPEG_PATH = "";
let FFPROBE_PATH = "";

try {
  const paths = resolveFFmpegPathsSync();
  if (paths) {
    FFMPEG_PATH = paths.ffmpeg;
    FFPROBE_PATH = paths.ffprobe;
  } else {
    console.log("[VideoCompose] No ffmpeg found at startup. Will auto-download on first use.");
  }
} catch (err) {
  console.error("[VideoCompose] Error during startup ffmpeg resolution:", err);
}

/**
 * Ensure ffmpeg paths are resolved (with async download fallback)
 */
async function ensureFFmpegAsync(): Promise<{ ffmpeg: string; ffprobe: string }> {
  if (FFMPEG_PATH && FFPROBE_PATH) {
    return { ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH };
  }
  const paths = await resolveFFmpegPathsAsync();
  FFMPEG_PATH = paths.ffmpeg;
  FFPROBE_PATH = paths.ffprobe;
  return paths;
}

/**
 * Sync version for functions that can't be async (uses cached paths only)
 */
function ensureFFmpegSync(): { ffmpeg: string; ffprobe: string } {
  if (FFMPEG_PATH && FFPROBE_PATH) {
    return { ffmpeg: FFMPEG_PATH, ffprobe: FFPROBE_PATH };
  }
  throw new Error(
    "[VideoCompose] ffmpeg not yet available. Call ensureFFmpegAsync() first to trigger download."
  );
}

/**
 * Theme-to-BGM URL mapping (server-side copy of client data).
 * These are CDN URLs for the background music tracks.
 */
const THEME_BGM: Record<string, string> = {
  adventure: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-adventure_0b3662ac.mp3",
  fairytale: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-fairytale_4dc7c904.mp3",
  space: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-space_311fe957.mp3",
  underwater: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-underwater_5b080e17.mp3",
  superhero: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-superhero_1f4aad97.mp3",
  dinosaur: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-dinosaur_bef1e869.mp3",
  pirate: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-pirate_af20f17e.mp3",
  enchantedForest: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-enchantedForest_35681286.mp3",
};

interface SceneAsset {
  sceneIndex: number;
  illustrationUrl: string;
  narrationUrl: string | null;
}

/**
 * Download a file from a URL to a local path.
 */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

/**
 * Get the duration of an audio file in seconds using ffprobe.
 */
async function getAudioDuration(filePath: string): Promise<number> {
  const { ffprobe } = ensureFFmpegSync();
  try {
    const { stdout } = await execAsync(
      `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 15000 }
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 5 : duration;
  } catch (err) {
    console.warn(`[VideoCompose] ffprobe failed for ${filePath}:`, err);
    return 5; // Default 5 seconds if probe fails
  }
}

/**
 * Run an ffmpeg command with detailed error logging.
 */
async function runFFmpeg(args: string, timeoutMs: number = 120000): Promise<void> {
  const { ffmpeg } = ensureFFmpegSync();
  const cmd = `"${ffmpeg}" ${args}`;
  try {
    await execAsync(cmd, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 });
  } catch (err: any) {
    const stderr = err?.stderr || "";
    const stdout = err?.stdout || "";
    console.error(`[VideoCompose] ffmpeg command FAILED:`);
    console.error(`[VideoCompose]   Command: ${cmd.substring(0, 300)}...`);
    console.error(`[VideoCompose]   Exit code: ${err?.code}`);
    console.error(`[VideoCompose]   Signal: ${err?.signal}`);
    console.error(`[VideoCompose]   stderr (last 500): ${stderr.slice(-500)}`);
    console.error(`[VideoCompose]   stdout (last 200): ${stdout.slice(-200)}`);
    throw new Error(`ffmpeg failed (exit ${err?.code}): ${stderr.slice(-200) || err?.message || "unknown error"}`);
  }
}

/**
 * Compose a full storybook video from scene assets.
 *
 * Pipeline:
 * 1. Ensure ffmpeg is available (auto-download if needed)
 * 2. Download all scene images and narration audio to temp dir
 * 3. For each scene, create a video clip: still image displayed for the duration of its narration
 * 4. Concatenate all scene clips into one video
 * 5. Mix in background music at low volume
 * 6. Output a single MP4 file
 *
 * @returns Buffer of the final MP4 video
 */
export async function composeStorybookVideo(
  scenes: SceneAsset[],
  storyTheme: string
): Promise<Buffer> {
  // Ensure ffmpeg is available - this will auto-download if needed (first time only)
  const { ffmpeg, ffprobe } = await ensureFFmpegAsync();
  console.log(`[VideoCompose] ffmpeg verified: ${ffmpeg}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storybook-video-"));

  try {
    console.log(`[VideoCompose] Starting composition in ${tmpDir} with ${scenes.length} scenes`);

    // Sort scenes by index
    const sortedScenes = [...scenes].sort((a, b) => a.sceneIndex - b.sceneIndex);

    // ─── Step 1: Download all assets ──────────────────────────────────
    const sceneFiles: { imagePath: string; audioPath: string | null; duration: number }[] = [];

    for (const scene of sortedScenes) {
      const imgPath = path.join(tmpDir, `scene_${scene.sceneIndex}.png`);
      await downloadToFile(scene.illustrationUrl, imgPath);

      let audioPath: string | null = null;
      let duration = 6; // Default duration if no audio

      if (scene.narrationUrl) {
        audioPath = path.join(tmpDir, `narration_${scene.sceneIndex}.mp3`);
        await downloadToFile(scene.narrationUrl, audioPath);
        duration = await getAudioDuration(audioPath);
        // Add a small buffer for pacing (1.5 seconds pause between scenes)
        duration = duration + 1.5;
      }

      sceneFiles.push({ imagePath: imgPath, audioPath, duration });
      console.log(`[VideoCompose] Scene ${scene.sceneIndex}: duration=${duration.toFixed(1)}s, hasAudio=${!!audioPath}`);
    }

    // ─── Step 2: Create individual scene video clips ─────────────────
    const clipPaths: string[] = [];

    for (let i = 0; i < sceneFiles.length; i++) {
      const { imagePath, audioPath, duration } = sceneFiles[i];
      const clipPath = path.join(tmpDir, `clip_${i}.mp4`);

      // Simple scale+pad filter — reliable across all environments (no zoompan which fails on Cloud Run)
      const videoFilter =
        `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,` +
        `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v]`;

      if (audioPath) {
        // Scene with narration: image displayed for audio duration + buffer
        await runFFmpeg(
          `-y -loop 1 -i "${imagePath}" -i "${audioPath}" ` +
          `-filter_complex "${videoFilter};[1:a]apad=pad_dur=${Math.ceil(duration)}[a]" ` +
          `-map "[v]" -map "[a]" ` +
          `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
          `-t ${duration.toFixed(2)} -shortest "${clipPath}"`,
          120000
        );
      } else {
        // Scene without narration: just the image with silence
        await runFFmpeg(
          `-y -loop 1 -i "${imagePath}" -f lavfi -i anullsrc=r=44100:cl=stereo ` +
          `-filter_complex "${videoFilter}" ` +
          `-map "[v]" -map 1:a ` +
          `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
          `-t ${duration.toFixed(2)} "${clipPath}"`,
          120000
        );
      }

      clipPaths.push(clipPath);
      console.log(`[VideoCompose] Created clip ${i}`);
    }

    // ─── Step 3: Concatenate all clips ───────────────────────────────
    const concatListPath = path.join(tmpDir, "concat_list.txt");
    const concatContent = clipPaths.map((p) => `file '${p}'`).join("\n");
    await fs.writeFile(concatListPath, concatContent);

    const concatPath = path.join(tmpDir, "concat.mp4");
    await runFFmpeg(
      `-y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatPath}"`,
      120000
    );
    console.log(`[VideoCompose] Concatenated ${clipPaths.length} clips`);

    // ─── Step 4: Mix in background music ─────────────────────────────
    const bgmUrl = THEME_BGM[storyTheme] || THEME_BGM["adventure"];
    const bgmPath = path.join(tmpDir, "bgm.mp3");
    const finalPath = path.join(tmpDir, "final_storybook.mp4");

    try {
      await downloadToFile(bgmUrl, bgmPath);

      // Get total video duration to loop BGM
      const { stdout: durationStr } = await execAsync(
        `"${ffprobe}" -v error -show_entries format=duration -of csv=p=0 "${concatPath}"`,
        { timeout: 15000 }
      );
      const totalDuration = parseFloat(durationStr.trim());

      // Mix: narration at full volume, BGM at 15% volume
      // -stream_loop -1 loops the BGM to cover the full video
      await runFFmpeg(
        `-y -i "${concatPath}" -stream_loop -1 -i "${bgmPath}" ` +
        `-filter_complex "` +
        `[1:a]volume=0.15[bgm];` +
        `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]` +
        `" -map 0:v -map "[aout]" ` +
        `-c:v copy -c:a aac -b:a 192k ` +
        `-t ${totalDuration.toFixed(2)} "${finalPath}"`,
        180000
      );
      console.log(`[VideoCompose] Mixed in background music (${storyTheme})`);
    } catch (bgmError) {
      console.warn(`[VideoCompose] BGM mixing failed, using video without BGM:`, bgmError);
      // Fall back to the concatenated video without BGM
      await fs.copyFile(concatPath, finalPath);
    }

    // ─── Step 5: Read and return the final video ─────────────────────
    const videoBuffer = await fs.readFile(finalPath);
    console.log(`[VideoCompose] Final video size: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`);

    return videoBuffer;
  } finally {
    // Clean up temp directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      console.log(`[VideoCompose] Cleaned up temp dir`);
    } catch {
      console.warn(`[VideoCompose] Failed to clean up ${tmpDir}`);
    }
  }
}

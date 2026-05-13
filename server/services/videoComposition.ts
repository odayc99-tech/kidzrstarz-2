import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const execAsync = promisify(exec);

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
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 15000 }
    );
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 5 : duration;
  } catch {
    return 5; // Default 5 seconds if probe fails
  }
}

/**
 * Compose a full storybook video from scene assets.
 *
 * Pipeline:
 * 1. Download all scene images and narration audio to temp dir
 * 2. For each scene, create a video clip: still image displayed for the duration of its narration
 * 3. Concatenate all scene clips into one video
 * 4. Mix in background music at low volume
 * 5. Output a single MP4 file
 *
 * @returns Buffer of the final MP4 video
 */
export async function composeStorybookVideo(
  scenes: SceneAsset[],
  storyTheme: string
): Promise<Buffer> {
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

      if (audioPath) {
        // Scene with narration: image displayed for audio duration + buffer
        // Use a subtle Ken Burns zoom effect for visual interest
        await execAsync(
          `ffmpeg -y -loop 1 -i "${imagePath}" -i "${audioPath}" ` +
          `-filter_complex "` +
          `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
          `zoompan=z='min(zoom+0.0005,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * 25)}:s=1920x1080:fps=25[v];` +
          `[1:a]apad=pad_dur=${Math.ceil(duration)}[a]` +
          `" -map "[v]" -map "[a]" ` +
          `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
          `-t ${duration.toFixed(2)} -shortest "${clipPath}"`,
          { timeout: 120000 }
        );
      } else {
        // Scene without narration: just the image with silence
        await execAsync(
          `ffmpeg -y -loop 1 -i "${imagePath}" -f lavfi -i anullsrc=r=44100:cl=stereo ` +
          `-filter_complex "` +
          `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
          `zoompan=z='min(zoom+0.0005,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * 25)}:s=1920x1080:fps=25[v]` +
          `" -map "[v]" -map 1:a ` +
          `-c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k ` +
          `-t ${duration.toFixed(2)} "${clipPath}"`,
          { timeout: 120000 }
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
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy "${concatPath}"`,
      { timeout: 120000 }
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
        `ffprobe -v error -show_entries format=duration -of csv=p=0 "${concatPath}"`,
        { timeout: 15000 }
      );
      const totalDuration = parseFloat(durationStr.trim());

      // Mix: narration at full volume, BGM at 15% volume
      // -stream_loop -1 loops the BGM to cover the full video
      await execAsync(
        `ffmpeg -y -i "${concatPath}" -stream_loop -1 -i "${bgmPath}" ` +
        `-filter_complex "` +
        `[1:a]volume=0.15[bgm];` +
        `[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]` +
        `" -map 0:v -map "[aout]" ` +
        `-c:v copy -c:a aac -b:a 192k ` +
        `-t ${totalDuration.toFixed(2)} "${finalPath}"`,
        { timeout: 180000 }
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

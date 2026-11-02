import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { storageReadBytes } from "../storage";
import {
  MUSIC_GAIN,
  TRUSTED_MUSIC_ASSET_PATH,
  type MusicSelection,
} from "./musicAssets";

const execAsync = promisify(exec);
const MUSIC_FADE_SECONDS = 1.5;

/**
 * Theme-to-BGM URL mapping retained only for orders created before immutable
 * experience sidecars. New orders must supply a saved MusicSelection instead.
 */
const THEME_BGM: Record<string, string> = {
  adventure:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-adventure_0b3662ac.mp3",
  fairytale:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-fairytale_4dc7c904.mp3",
  space:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-space_311fe957.mp3",
  underwater:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-underwater_5b080e17.mp3",
  superhero:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-superhero_1f4aad97.mp3",
  dinosaur:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-dinosaur_bef1e869.mp3",
  pirate:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-pirate_af20f17e.mp3",
  enchantedForest:
    "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-enchantedForest_35681286.mp3",
};

export interface SceneAsset {
  sceneIndex: number;
  /** A canonical permanent object key, preferred over the legacy URL. */
  illustrationKey?: string | null;
  illustrationUrl?: string | null;
  /** A canonical permanent object key, preferred over the legacy URL. */
  narrationKey?: string | null;
  narrationUrl?: string | null;
}

/**
 * Download a file from a URL to a local path. This is retained exclusively for
 * legacy URL-only scene records and legacy CDN background music tracks.
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
 * Materialize a stored paid asset. A supplied key is authoritative: if the SDK
 * read fails, the URL is deliberately not tried as a fallback. URL fetches are
 * allowed only for pre-migration URL-only records.
 */
async function materializeSceneAsset(
  key: string | null | undefined,
  legacyUrl: string | null | undefined,
  destPath: string,
  label: string
): Promise<void> {
  if (key) {
    const stored = await storageReadBytes(key);
    await fs.writeFile(destPath, stored.data);
    return;
  }

  if (legacyUrl) {
    await downloadToFile(legacyUrl, destPath);
    return;
  }

  throw new Error(
    `Scene ${label} has neither a canonical key nor a legacy URL`
  );
}

/** Resolve a web asset path to the server-controlled local asset root. */
export function trustedMusicFilePath(
  assetPath: string,
  environment = process.env.NODE_ENV
): string {
  if (!TRUSTED_MUSIC_ASSET_PATH.test(assetPath)) {
    throw new Error("Saved music asset path is not trusted");
  }

  const publicRoot = path.resolve(
    process.cwd(),
    environment === "production" ? "dist/public" : "client/public"
  );
  // Prefix with '.' so an absolute web path cannot reset the trusted root.
  const resolved = path.resolve(publicRoot, `.${assetPath}`);
  const relative = path.relative(publicRoot, resolved);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "Saved music asset path escapes the trusted public directory"
    );
  }
  return resolved;
}

/** Copy a validated bundled music file into the private composition directory. */
async function materializeTrustedMusic(
  selection: MusicSelection,
  destination: string
): Promise<void> {
  if (selection.volume !== MUSIC_GAIN) {
    throw new Error(`Saved music must use the fixed ${MUSIC_GAIN} gain`);
  }
  const source = trustedMusicFilePath(selection.assetPath);
  // Access and copy failures are fatal for a saved selection. Do not replace a
  // customer's frozen selection with silence or a different track.
  await fs.access(source);
  await fs.copyFile(source, destination);
}

/** Get the duration of an audio file in seconds using ffprobe. */
async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { timeout: 15000 }
    );
    const duration = parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration > 0 ? duration : 5;
  } catch {
    return 5; // Default 5 seconds if probe fails
  }
}

async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { timeout: 15000 }
  );
  const duration = parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine a valid storybook video duration");
  }
  return duration;
}

/**
 * Combine the unmodified narration stream with a low, ducked music stream.
 * The background is compressed only when narration is present. Narration is
 * never volume-reduced; amix normalization is disabled and a final limiter
 * prevents summing peaks from clipping.
 */
async function mixMusic(
  concatPath: string,
  musicPath: string,
  finalPath: string
): Promise<void> {
  const totalDuration = await getVideoDuration(concatPath);
  const fadeOutStart = Math.max(0, totalDuration - MUSIC_FADE_SECONDS);
  await execAsync(
    `ffmpeg -y -i "${concatPath}" -stream_loop -1 -i "${musicPath}" ` +
      `-filter_complex "` +
      `[1:a]volume=${MUSIC_GAIN},afade=t=in:st=0:d=${MUSIC_FADE_SECONDS},` +
      `afade=t=out:st=${fadeOutStart.toFixed(2)}:d=${MUSIC_FADE_SECONDS}[music];` +
      `[music][0:a]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=450[duckedMusic];` +
      `[0:a][duckedMusic]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,` +
      `alimiter=limit=0.95[aout]` +
      `" -map 0:v -map "[aout]" ` +
      `-c:v copy -c:a aac -b:a 192k -movflags +faststart ` +
      `-t ${totalDuration.toFixed(2)} "${finalPath}"`,
    { timeout: 180000 }
  );
}

/**
 * Compose a full storybook video from scene assets.
 *
 * Undefined `musicSelection` deliberately preserves the legacy theme-to-CDN
 * mapping and its established non-fatal no-music fallback. `null` represents a
 * saved narration-only experience and bypasses any BGM loading. A concrete
 * saved selection is a trusted local asset and failures are intentionally fatal.
 *
 * @returns Buffer of the final MP4 video
 */
export async function composeStorybookVideo(
  scenes: SceneAsset[],
  storyTheme: string,
  musicSelection?: MusicSelection | null
): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storybook-video-"));

  try {
    console.log(
      `[VideoCompose] Starting composition in ${tmpDir} with ${scenes.length} scenes`
    );

    const sortedScenes = [...scenes].sort(
      (a, b) => a.sceneIndex - b.sceneIndex
    );
    const sceneFiles: {
      imagePath: string;
      audioPath: string | null;
      duration: number;
    }[] = [];

    for (const scene of sortedScenes) {
      const imgPath = path.join(tmpDir, `scene_${scene.sceneIndex}.png`);
      await materializeSceneAsset(
        scene.illustrationKey,
        scene.illustrationUrl,
        imgPath,
        `illustration ${scene.sceneIndex}`
      );

      let audioPath: string | null = null;
      let duration = 6;
      if (scene.narrationKey || scene.narrationUrl) {
        audioPath = path.join(tmpDir, `narration_${scene.sceneIndex}.mp3`);
        await materializeSceneAsset(
          scene.narrationKey,
          scene.narrationUrl,
          audioPath,
          `narration ${scene.sceneIndex}`
        );
        duration = (await getAudioDuration(audioPath)) + 1.5;
      }

      sceneFiles.push({ imagePath: imgPath, audioPath, duration });
      console.log(
        `[VideoCompose] Scene ${scene.sceneIndex}: duration=${duration.toFixed(1)}s, hasAudio=${!!audioPath}`
      );
    }

    const clipPaths: string[] = [];
    for (let i = 0; i < sceneFiles.length; i++) {
      const { imagePath, audioPath, duration } = sceneFiles[i];
      const clipPath = path.join(tmpDir, `clip_${i}.mp4`);

      if (audioPath) {
        await execAsync(
          `ffmpeg -y -loop 1 -i "${imagePath}" -i "${audioPath}" ` +
            `-filter_complex "` +
            `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
            `zoompan=z='min(zoom+0.0005,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * 25)}:s=1920x1080:fps=25[v];` +
            `[1:a]apad=pad_dur=${Math.ceil(duration)}[a]` +
            `" -map "[v]" -map "[a]" ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -profile:v high -level:v 4.1 -c:a aac -b:a 128k -movflags +faststart ` +
            `-t ${duration.toFixed(2)} -shortest "${clipPath}"`,
          { timeout: 120000 }
        );
      } else {
        await execAsync(
          `ffmpeg -y -loop 1 -i "${imagePath}" -f lavfi -i anullsrc=r=44100:cl=stereo ` +
            `-filter_complex "` +
            `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,` +
            `zoompan=z='min(zoom+0.0005,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(duration * 25)}:s=1920x1080:fps=25[v]` +
            `" -map "[v]" -map 1:a ` +
            `-c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -profile:v high -level:v 4.1 -c:a aac -b:a 128k -movflags +faststart ` +
            `-t ${duration.toFixed(2)} "${clipPath}"`,
          { timeout: 120000 }
        );
      }

      clipPaths.push(clipPath);
      console.log(`[VideoCompose] Created clip ${i}`);
    }

    const concatListPath = path.join(tmpDir, "concat_list.txt");
    await fs.writeFile(
      concatListPath,
      clipPaths.map(clip => `file '${clip}'`).join("\n")
    );
    const concatPath = path.join(tmpDir, "concat.mp4");
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy -movflags +faststart "${concatPath}"`,
      { timeout: 120000 }
    );
    console.log(`[VideoCompose] Concatenated ${clipPaths.length} clips`);

    const finalPath = path.join(tmpDir, "final_storybook.mp4");
    if (musicSelection === null) {
      // A saved explicit no-music decision must not fall back to legacy theme BGM.
      await fs.copyFile(concatPath, finalPath);
      console.log("[VideoCompose] Saved experience intentionally has no music");
    } else if (musicSelection) {
      const bgmPath = path.join(tmpDir, "saved-bgm.mp3");
      await materializeTrustedMusic(musicSelection, bgmPath);
      await mixMusic(concatPath, bgmPath, finalPath);
      console.log(
        `[VideoCompose] Mixed saved music selection (${musicSelection.id})`
      );
    } else {
      const legacyBgmUrl = THEME_BGM[storyTheme] || THEME_BGM.adventure;
      const bgmPath = path.join(tmpDir, "legacy-bgm.mp3");
      try {
        await downloadToFile(legacyBgmUrl, bgmPath);
        await mixMusic(concatPath, bgmPath, finalPath);
        console.log(
          `[VideoCompose] Mixed legacy background music (${storyTheme})`
        );
      } catch (bgmError) {
        // Preserve legacy behavior only: old CDN tracks can be unavailable
        // without blocking playback of an otherwise complete historic story.
        console.warn(
          "[VideoCompose] Legacy BGM mixing failed, using video without BGM:",
          bgmError
        );
        await fs.copyFile(concatPath, finalPath);
      }
    }

    const videoBuffer = await fs.readFile(finalPath);
    if (videoBuffer.length === 0) {
      throw new Error("Video composition returned an empty MP4");
    }
    console.log(
      `[VideoCompose] Final video size: ${(videoBuffer.length / 1024 / 1024).toFixed(1)}MB`
    );
    return videoBuffer;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
      console.log("[VideoCompose] Cleaned up temp dir");
    } catch {
      console.warn(`[VideoCompose] Failed to clean up ${tmpDir}`);
    }
  }
}

import ffmpeg from "fluent-ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ─── Background music served from static storage ──────────────────────────────
// Uploaded via: manus-upload-file --webdev background_music.mp3
const BACKGROUND_MUSIC_URL = "/manus-storage/background_music_0963cf47.mp3";

// ─── Constants ────────────────────────────────────────────────────────────────
const FADE_DURATION = 0.5;   // seconds of xfade crossfade between clips
const TITLE_DURATION = 3;    // seconds for title/end cards
const WIDTH = 1280;
const HEIGHT = 720;
const MUSIC_VOLUME = 0.12;   // background music volume relative to narration (12%)
const SUBTITLE_FONT_SIZE = 30;
const SUBTITLE_MAX_CHARS_PER_LINE = 60;

export interface SceneInput {
  sceneIndex: number;
  sceneText: string | null;
  illustrationUrl: string;
  narrationUrl: string;
}

export interface VideoComposerOptions {
  orderId: number;
  childName: string;
  storyTheme: string;
  scenes: SceneInput[];
  outputPath: string;
  /** Optional: override the background music URL (e.g. for testing) */
  backgroundMusicUrl?: string;
}

// ─── Text utilities ───────────────────────────────────────────────────────────

/**
 * Wrap text into lines of at most `maxChars` characters, split on word boundaries.
 * Returns at most 2 lines to keep the subtitle area compact.
 */
function wrapText(text: string, maxChars = SUBTITLE_MAX_CHARS_PER_LINE): string {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if ((current + " " + word).trim().length <= maxChars) {
      current = (current + " " + word).trim();
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length >= 2) break; // cap at 2 lines
    }
  }
  if (current && lines.length < 2) lines.push(current);

  return lines.join("\n");
}

/**
 * Escape special characters that would break ffmpeg drawtext filter expressions.
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\u2019")   // replace straight apostrophe with curly
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

// ─── Download helper ──────────────────────────────────────────────────────────

async function downloadToTemp(url: string, ext: string, tmpDir: string): Promise<string> {
  const filePath = path.join(tmpDir, `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);

  // Handle relative /manus-storage/ paths by resolving against the server base
  const fullUrl = url.startsWith("/") ? `http://localhost:${process.env.PORT ?? 3000}${url}` : url;

  const response = await fetch(fullUrl);
  if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`);
  const buffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

// ─── ffprobe helpers ──────────────────────────────────────────────────────────

function getAudioDuration(audioPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(Math.max(metadata?.format?.duration ?? 4, 1));
    });
  });
}

function getClipDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata?.format?.duration ?? 3);
    });
  });
}

// ─── Scene clip renderer ──────────────────────────────────────────────────────

/**
 * Render a single scene:
 *  - image displayed for the narration audio duration
 *  - scene text burned as a subtitle at the bottom
 *  - background music mixed in at low volume under the narration
 */
function renderSceneClip(
  imagePath: string,
  audioPath: string,
  musicPath: string,
  audioDuration: number,
  sceneText: string | null,
  outputPath: string
): Promise<void> {
  const totalDuration = audioDuration + 0.5;

  // Build subtitle drawtext filter (only if text is provided)
  let subtitleFilter = "";
  if (sceneText && sceneText.trim()) {
    const wrapped = wrapText(sceneText);
    const safe = escapeDrawtext(wrapped);
    subtitleFilter =
      `,drawtext=text='${safe}':fontsize=${SUBTITLE_FONT_SIZE}:fontcolor=white` +
      `:x=(w-text_w)/2:y=h-100:font=Sans` +
      `:box=1:boxcolor=black@0.65:boxborderw=10:line_spacing=6`;
  }

  return new Promise((resolve, reject) => {
    ffmpeg()
      // Input 0: image (looped)
      .input(imagePath)
      .inputOptions(["-loop 1", `-t ${totalDuration}`, "-framerate 25"])
      // Input 1: narration audio
      .input(audioPath)
      .inputOptions([`-t ${totalDuration}`])
      // Input 2: background music (looped to match duration)
      .input(musicPath)
      .inputOptions(["-stream_loop -1", `-t ${totalDuration}`])
      .complexFilter([
        // Video: scale + pad + subtitle overlay
        `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=25${subtitleFilter}[v]`,
        // Audio: mix narration (weight 1) + music (weight MUSIC_VOLUME)
        `[1:a][2:a]amix=inputs=2:weights=1 ${MUSIC_VOLUME}:duration=first[a]`,
      ])
      .outputOptions([
        "-map [v]",
        "-map [a]",
        "-c:v libx264",
        "-preset fast",
        "-crf 23",
        "-c:a aac",
        "-b:a 128k",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
        `-t ${totalDuration}`,
        "-shortest",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Scene render failed: ${err.message}`)))
      .run();
  });
}

// ─── Title / end card renderer ────────────────────────────────────────────────

/**
 * Render a branded title or end card with background music.
 */
function renderTitleCard(
  text: string,
  subtext: string,
  musicPath: string,
  outputPath: string,
  duration = TITLE_DURATION
): Promise<void> {
  const safeText = escapeDrawtext(text);
  const safeSubtext = escapeDrawtext(subtext);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(`color=c=0x6B21A8:size=${WIDTH}x${HEIGHT}:rate=25:duration=${duration}`)
      .inputOptions(["-f lavfi"])
      .input(musicPath)
      .inputOptions(["-stream_loop -1", `-t ${duration}`])
      .complexFilter([
        `[0:v]drawtext=text='${safeText}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2-40:font=Sans,` +
        `drawtext=text='${safeSubtext}':fontsize=36:fontcolor=0xF9A8D4:x=(w-text_w)/2:y=(h-text_h)/2+60:font=Sans,fps=25[v]`,
        // Music only (no narration on title cards), at full music volume
        `[1:a]volume=${MUSIC_VOLUME * 2}[a]`,
      ])
      .outputOptions([
        "-map [v]",
        "-map [a]",
        "-c:v libx264",
        "-preset fast",
        "-crf 23",
        "-c:a aac",
        "-b:a 128k",
        "-pix_fmt yuv420p",
        `-t ${duration}`,
        "-shortest",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Title card render failed: ${err.message}`)))
      .run();
  });
}

// ─── Crossfade concatenation ──────────────────────────────────────────────────

/**
 * Concatenate clips with xfade video crossfade transitions and audio concat.
 */
function concatenateWithCrossfade(
  clips: { path: string; duration: number }[],
  outputPath: string
): Promise<void> {
  if (clips.length === 0) throw new Error("No clips to concatenate");

  if (clips.length === 1) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(clips[0].path)
        .outputOptions(["-c copy"])
        .output(outputPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(new Error(`Single clip copy failed: ${err.message}`)))
        .run();
    });
  }

  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    for (const clip of clips) cmd.input(clip.path);

    const n = clips.length;
    const filterParts: string[] = [];
    let currentVideoLabel = "[0:v]";
    let cumulativeDuration = clips[0].duration;

    for (let i = 1; i < n; i++) {
      const offset = Math.max(cumulativeDuration - FADE_DURATION, 0.1);
      const nextLabel = i === n - 1 ? "[vout]" : `[v${i}]`;
      filterParts.push(
        `${currentVideoLabel}[${i}:v]xfade=transition=fade:duration=${FADE_DURATION}:offset=${offset.toFixed(3)}${nextLabel}`
      );
      currentVideoLabel = nextLabel;
      cumulativeDuration += clips[i].duration - FADE_DURATION;
    }

    // Audio concat (background music is already baked into each clip)
    const audioInputs = clips.map((_, i) => `[${i}:a]`).join("");
    filterParts.push(`${audioInputs}concat=n=${n}:v=0:a=1[aout]`);

    cmd
      .complexFilter(filterParts)
      .outputOptions([
        "-map [vout]",
        "-map [aout]",
        "-c:v libx264",
        "-preset fast",
        "-crf 23",
        "-c:a aac",
        "-b:a 128k",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err) => reject(new Error(`Crossfade concat failed: ${err.message}`)))
      .run();
  });
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Compose a full storybook MP4:
 *  - Title card (branded purple background + music)
 *  - 5 scene clips (image + narration + background music + subtitle text)
 *  - End card (branded + music)
 *  - All clips joined with xfade crossfade transitions
 *
 * Returns the path to the final MP4 (same as `options.outputPath`).
 */
export async function composeStorybookVideo(options: VideoComposerOptions): Promise<string> {
  const {
    orderId,
    childName,
    storyTheme,
    scenes,
    outputPath,
    backgroundMusicUrl = BACKGROUND_MUSIC_URL,
  } = options;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `kidzrstarz-${orderId}-`));
  console.log(`[VideoComposer] Starting MP4 for order ${orderId} in ${tmpDir}`);

  try {
    // ── Download background music once ────────────────────────────────────────
    console.log(`[VideoComposer] Downloading background music...`);
    const musicPath = await downloadToTemp(backgroundMusicUrl, "mp3", tmpDir);
    console.log(`[VideoComposer] Background music ready`);

    const clips: { path: string; duration: number }[] = [];

    // ── Title card ────────────────────────────────────────────────────────────
    const titlePath = path.join(tmpDir, "00_title.mp4");
    await renderTitleCard(
      `${childName}\u2019s Storybook`,
      `A ${storyTheme} adventure`,
      musicPath,
      titlePath,
      TITLE_DURATION
    );
    clips.push({ path: titlePath, duration: TITLE_DURATION });
    console.log(`[VideoComposer] Title card rendered`);

    // ── Scene clips ───────────────────────────────────────────────────────────
    for (const scene of scenes) {
      console.log(`[VideoComposer] Rendering scene ${scene.sceneIndex}/${scenes.length}`);

      const imgExt = scene.illustrationUrl.includes(".png") ? "png" : "jpg";
      const imagePath = await downloadToTemp(scene.illustrationUrl, imgExt, tmpDir);
      const audioPath = await downloadToTemp(scene.narrationUrl, "mp3", tmpDir);

      const audioDuration = await getAudioDuration(audioPath);
      console.log(`[VideoComposer] Scene ${scene.sceneIndex} audio: ${audioDuration.toFixed(2)}s`);

      const clipPath = path.join(tmpDir, `scene_${scene.sceneIndex}.mp4`);
      await renderSceneClip(
        imagePath,
        audioPath,
        musicPath,
        audioDuration,
        scene.sceneText,
        clipPath
      );

      const clipDuration = await getClipDuration(clipPath);
      clips.push({ path: clipPath, duration: clipDuration });
      console.log(`[VideoComposer] Scene ${scene.sceneIndex} rendered (${clipDuration.toFixed(2)}s)`);
    }

    // ── End card ──────────────────────────────────────────────────────────────
    const endPath = path.join(tmpDir, "99_end.mp4");
    await renderTitleCard(
      "The End",
      "Created with KidzRstarz \u2728",
      musicPath,
      endPath,
      TITLE_DURATION
    );
    clips.push({ path: endPath, duration: TITLE_DURATION });
    console.log(`[VideoComposer] End card rendered`);

    // ── Concatenate with crossfade transitions ────────────────────────────────
    console.log(`[VideoComposer] Concatenating ${clips.length} clips with xfade transitions...`);
    await concatenateWithCrossfade(clips, outputPath);

    const finalDuration = await getClipDuration(outputPath);
    console.log(`[VideoComposer] MP4 composed: ${outputPath} (${finalDuration.toFixed(1)}s)`);

    return outputPath;
  } finally {
    // Best-effort cleanup of temp files (not the output)
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        const fp = path.join(tmpDir, f);
        if (fp !== outputPath) {
          try { fs.unlinkSync(fp); } catch {}
        }
      }
      fs.rmdirSync(tmpDir);
    } catch {}
  }
}

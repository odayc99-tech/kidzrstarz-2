/**
 * Client-side video composer using Canvas + MediaRecorder.
 * Creates a storybook video from scene images and narration audio
 * entirely in the browser — no server-side ffmpeg needed.
 */

interface ComposerScene {
  illustrationUrl: string;
  narrationUrl: string | null;
  sceneText: string;
}

interface ComposerOptions {
  scenes: ComposerScene[];
  bgmUrl?: string;
  bgmVolume?: number;
  onProgress?: (progress: number, status: string) => void;
}

/**
 * Load an image from a URL and return an HTMLImageElement.
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
}

/**
 * Load audio from a URL and return an AudioBuffer.
 */
async function loadAudio(
  audioContext: AudioContext,
  url: string
): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch audio: ${url}`);
  const arrayBuffer = await response.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

/**
 * Get the duration of an audio file in seconds.
 */
async function getAudioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(audio.duration || 5);
    };
    audio.onerror = () => resolve(5);
    audio.src = url;
  });
}

/**
 * Draw an image on canvas with cover-fit (fills entire canvas).
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number,
  scale: number = 1
) {
  const imgRatio = img.width / img.height;
  const canvasRatio = canvasWidth / canvasHeight;

  let drawWidth: number, drawHeight: number;
  if (imgRatio > canvasRatio) {
    drawHeight = canvasHeight * scale;
    drawWidth = drawHeight * imgRatio;
  } else {
    drawWidth = canvasWidth * scale;
    drawHeight = drawWidth / imgRatio;
  }

  const x = (canvasWidth - drawWidth) / 2;
  const y = (canvasHeight - drawHeight) / 2;

  ctx.drawImage(img, x, y, drawWidth, drawHeight);
}

/**
 * Compose a storybook video from scenes in the browser.
 * Returns a Blob of the final MP4/WebM video.
 */
export async function composeVideoInBrowser(
  options: ComposerOptions
): Promise<Blob> {
  const { scenes, bgmUrl, bgmVolume = 0.15, onProgress } = options;

  if (scenes.length === 0) {
    throw new Error("No scenes to compose");
  }

  const WIDTH = 1280;
  const HEIGHT = 720;
  const FPS = 30;

  onProgress?.(0, "Preparing assets...");

  // Create canvas
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d")!;

  // Pre-load all images
  onProgress?.(5, "Loading scene images...");
  const images: HTMLImageElement[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.illustrationUrl) {
      try {
        const img = await loadImage(scene.illustrationUrl);
        images.push(img);
      } catch {
        // Create a placeholder
        const placeholder = document.createElement("canvas");
        placeholder.width = WIDTH;
        placeholder.height = HEIGHT;
        const pCtx = placeholder.getContext("2d")!;
        pCtx.fillStyle = "#1e1b4b";
        pCtx.fillRect(0, 0, WIDTH, HEIGHT);
        pCtx.fillStyle = "#a78bfa";
        pCtx.font = "32px sans-serif";
        pCtx.textAlign = "center";
        pCtx.fillText(`Scene ${i + 1}`, WIDTH / 2, HEIGHT / 2);
        const img = new Image();
        img.src = placeholder.toDataURL();
        await new Promise((r) => (img.onload = r));
        images.push(img);
      }
    }
    onProgress?.(5 + (i / scenes.length) * 15, `Loading image ${i + 1}/${scenes.length}...`);
  }

  // Get audio durations
  onProgress?.(20, "Analyzing audio...");
  const sceneDurations: number[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.narrationUrl) {
      const duration = await getAudioDuration(scene.narrationUrl);
      sceneDurations.push(duration + 1.5); // Add buffer between scenes
    } else {
      sceneDurations.push(6); // Default 6 seconds for scenes without audio
    }
  }

  const totalDuration = sceneDurations.reduce((a, b) => a + b, 0);
  const totalFrames = Math.ceil(totalDuration * FPS);

  // Set up MediaRecorder with audio context
  const audioContext = new AudioContext({ sampleRate: 44100 });
  const destination = audioContext.createMediaStreamDestination();

  // Merge canvas stream with audio
  const canvasStream = canvas.captureStream(FPS);
  const videoTrack = canvasStream.getVideoTracks()[0];

  const combinedStream = new MediaStream();
  combinedStream.addTrack(videoTrack);
  destination.stream.getAudioTracks().forEach((t) => combinedStream.addTrack(t));

  // Load and schedule all narration audio
  onProgress?.(25, "Loading narration audio...");
  let currentTime = 0;
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.narrationUrl) {
      try {
        const audioBuffer = await loadAudio(audioContext, scene.narrationUrl);
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(destination);
        source.start(currentTime);
      } catch (e) {
        console.warn(`Failed to load narration for scene ${i}:`, e);
      }
    }
    currentTime += sceneDurations[i];
    onProgress?.(25 + (i / scenes.length) * 10, `Preparing audio ${i + 1}/${scenes.length}...`);
  }

  // Load and schedule background music
  if (bgmUrl) {
    try {
      onProgress?.(35, "Loading background music...");
      const bgmBuffer = await loadAudio(audioContext, bgmUrl);
      const bgmGain = audioContext.createGain();
      bgmGain.gain.value = bgmVolume;
      bgmGain.connect(destination);

      // Loop BGM to cover total duration
      const loopCount = Math.ceil(totalDuration / bgmBuffer.duration);
      for (let l = 0; l < loopCount; l++) {
        const bgmSource = audioContext.createBufferSource();
        bgmSource.buffer = bgmBuffer;
        bgmSource.connect(bgmGain);
        bgmSource.start(l * bgmBuffer.duration);
      }
    } catch (e) {
      console.warn("Failed to load BGM:", e);
    }
  }

  // Determine supported MIME type
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
    ? "video/webm;codecs=vp9,opus"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
      ? "video/webm;codecs=vp8,opus"
      : "video/webm";

  const recorder = new MediaRecorder(combinedStream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mimeType }));
    };
  });

  // Start recording
  recorder.start(1000); // Collect data every second
  onProgress?.(40, "Recording video...");

  // Render frames
  let frameIndex = 0;
  let sceneStartFrame = 0;

  for (let sceneIdx = 0; sceneIdx < scenes.length; sceneIdx++) {
    const sceneFrames = Math.ceil(sceneDurations[sceneIdx] * FPS);
    const img = images[sceneIdx];

    for (let f = 0; f < sceneFrames && frameIndex < totalFrames; f++) {
      // Clear canvas
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Ken Burns effect: subtle zoom from 1.0 to 1.06
      const progress = f / sceneFrames;
      const scale = 1.0 + progress * 0.06;

      // Fade in/out
      let alpha = 1;
      const fadeFrames = Math.min(FPS * 0.8, sceneFrames * 0.15);
      if (f < fadeFrames) {
        alpha = f / fadeFrames;
      } else if (f > sceneFrames - fadeFrames) {
        alpha = (sceneFrames - f) / fadeFrames;
      }

      ctx.globalAlpha = alpha;
      drawImageCover(ctx, img, WIDTH, HEIGHT, scale);
      ctx.globalAlpha = 1;

      frameIndex++;

      // Update progress (40% to 95%)
      const overallProgress = 40 + (frameIndex / totalFrames) * 55;
      if (frameIndex % (FPS * 2) === 0) {
        onProgress?.(
          overallProgress,
          `Rendering scene ${sceneIdx + 1}/${scenes.length}...`
        );
      }

      // Yield to browser to keep it responsive
      if (frameIndex % FPS === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    sceneStartFrame += sceneFrames;
  }

  // Stop recording
  recorder.stop();
  audioContext.close();

  onProgress?.(95, "Finalizing video...");
  const videoBlob = await recordingDone;
  onProgress?.(100, "Done!");

  return videoBlob;
}

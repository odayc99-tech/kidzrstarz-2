import { EdgeTTS } from "edge-tts-universal";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import axios from "axios";
import { getStorageNamespace } from "./storageNamespace";

// ─── ElevenLabs Configuration ───────────────────────────────────────────────
const ELEVENLABS_API_KEY = () => process.env.ELEVENLABS_API_KEY || "";
const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

// Default ElevenLabs voice for children's stories (cheerful, warm)
const ELEVENLABS_DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah" - soft, warm, young female

/**
 * Available cheerful, natural-sounding Edge TTS voices (fallback).
 */
export const CHILDREN_STORY_VOICES: Record<string, { name: string; gender: string; style: string }> = {
  "en-US-AnaNeural": { name: "Ana", gender: "female", style: "Young, cheerful" },
  "en-US-AriaNeural": { name: "Aria", gender: "female", style: "Expressive, warm" },
  "en-US-JennyNeural": { name: "Jenny", gender: "female", style: "Friendly, warm" },
  "en-GB-SoniaNeural": { name: "Sonia", gender: "female", style: "Warm, British" },
  "en-US-GuyNeural": { name: "Guy", gender: "male", style: "Friendly, warm" },
  "en-US-DavisNeural": { name: "Davis", gender: "male", style: "Calm, storytelling" },
};

const DEFAULT_EDGE_VOICE = "en-US-AnaNeural";

// ─── ElevenLabs Voice Management ──────────────────────────────────────────

/**
 * List all voices in the ElevenLabs account and return the custom (cloned) ones.
 */
async function listCustomVoices(): Promise<Array<{ voice_id: string; name: string; created_at_unix?: number }>> {
  const apiKey = ELEVENLABS_API_KEY();
  if (!apiKey) return [];

  try {
    const response = await axios.get(`${ELEVENLABS_BASE_URL}/voices`, {
      headers: { "xi-api-key": apiKey },
      timeout: 15000,
    });

    const voices = response.data?.voices || [];
    // Filter to only cloned/custom voices (category: "cloned" or names starting with "PixarMagic-")
    return voices.filter((v: any) =>
      v.category === "cloned" || (v.name && v.name.startsWith("PixarMagic-"))
    ).map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      created_at_unix: v.created_at_unix || 0,
    }));
  } catch (error) {
    console.warn("[ElevenLabs] Failed to list voices:", error instanceof Error ? error.message : error);
    return [];
  }
}

/**
 * Delete old cloned voices to free up slots.
 * Keeps the most recent `keepCount` voices and deletes the rest.
 */
async function cleanupOldVoices(keepCount: number = 3): Promise<number> {
  const apiKey = ELEVENLABS_API_KEY();
  if (!apiKey) return 0;

  const customVoices = await listCustomVoices();
  if (customVoices.length <= keepCount) {
    console.log(`[ElevenLabs] Only ${customVoices.length} custom voices, no cleanup needed`);
    return 0;
  }

  // Sort by creation time (oldest first) and delete the oldest ones
  customVoices.sort((a, b) => (a.created_at_unix || 0) - (b.created_at_unix || 0));
  const toDelete = customVoices.slice(0, customVoices.length - keepCount);

  let deleted = 0;
  for (const voice of toDelete) {
    try {
      await axios.delete(`${ELEVENLABS_BASE_URL}/voices/${voice.voice_id}`, {
        headers: { "xi-api-key": apiKey },
        timeout: 15000,
      });
      console.log(`[ElevenLabs] Deleted old voice: ${voice.name} (${voice.voice_id})`);
      deleted++;
    } catch (error) {
      console.warn(`[ElevenLabs] Failed to delete voice ${voice.voice_id}:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`[ElevenLabs] Cleaned up ${deleted} old voices, keeping ${keepCount} most recent`);
  return deleted;
}

// ─── ElevenLabs Voice Cloning ───────────────────────────────────────────────

/**
 * Clone a voice using ElevenLabs Instant Voice Cloning.
 * Downloads the voice sample from S3, uploads it to ElevenLabs, and returns the cloned voice ID.
 * If the voice limit is reached, automatically cleans up old cloned voices and retries.
 */
export async function cloneVoiceWithElevenLabs(
  voiceSampleUrl: string,
  voiceName: string = "Custom Voice"
): Promise<string | null> {
  const apiKey = ELEVENLABS_API_KEY();
  if (!apiKey) {
    console.warn("[ElevenLabs] No API key configured, cannot clone voice");
    return null;
  }

  try {
    console.log(`[ElevenLabs] Starting voice cloning for "${voiceName}"...`);

    // Step 1: Download the voice sample from S3
    const sampleResponse = await axios.get(voiceSampleUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    const sampleBuffer = Buffer.from(sampleResponse.data);
    console.log(`[ElevenLabs] Downloaded voice sample (${sampleBuffer.length} bytes)`);

    // Step 2: Try to clone the voice
    const result = await attemptVoiceClone(apiKey, sampleBuffer, voiceName);
    if (result) return result;

    // Step 3: If cloning failed due to voice limit, clean up old voices and retry
    console.log(`[ElevenLabs] First clone attempt failed, cleaning up old voices and retrying...`);
    const cleaned = await cleanupOldVoices(2); // Keep only 2 most recent
    if (cleaned > 0) {
      // Wait a moment for ElevenLabs to process deletions
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const retryResult = await attemptVoiceClone(apiKey, sampleBuffer, voiceName);
      if (retryResult) return retryResult;
    }

    console.warn("[ElevenLabs] Voice cloning failed even after cleanup");
    return null;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error(
        `[ElevenLabs] Voice cloning failed:`,
        error.response?.status,
        error.response?.data ? JSON.stringify(error.response.data).slice(0, 500) : error.message
      );
    } else {
      console.error(`[ElevenLabs] Voice cloning failed:`, error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/**
 * Attempt to clone a voice with ElevenLabs. Returns voice ID on success, null on failure.
 */
async function attemptVoiceClone(
  apiKey: string,
  sampleBuffer: Buffer,
  voiceName: string
): Promise<string | null> {
  try {
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("name", `PixarMagic-${voiceName}-${nanoid(6)}`);
    form.append("description", `Cloned voice for children's storybook narration - ${voiceName}`);
    form.append("files", sampleBuffer, {
      filename: "voice-sample.webm",
      contentType: "audio/webm",
    });

    const cloneResponse = await axios.post(
      `${ELEVENLABS_BASE_URL}/voices/add`,
      form,
      {
        headers: {
          "xi-api-key": apiKey,
          ...form.getHeaders(),
        },
        timeout: 60000,
      }
    );

    const voiceId = cloneResponse.data?.voice_id;
    if (!voiceId) {
      console.error("[ElevenLabs] Voice cloning response missing voice_id:", cloneResponse.data);
      return null;
    }

    console.log(`[ElevenLabs] Voice cloned successfully! Voice ID: ${voiceId}`);
    return voiceId;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const detail = error.response?.data?.detail;
      if (detail?.status === "voice_limit_reached") {
        console.warn(`[ElevenLabs] Voice limit reached (${detail.message})`);
        return null; // Caller will handle cleanup and retry
      }
      console.error(
        `[ElevenLabs] Clone attempt failed:`,
        error.response?.status,
        error.response?.data ? JSON.stringify(error.response.data).slice(0, 500) : error.message
      );
    } else {
      console.error(`[ElevenLabs] Clone attempt failed:`, error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/**
 * Generate narration using ElevenLabs TTS with a specific voice ID.
 */
async function generateWithElevenLabs(
  text: string,
  voiceId: string,
  userId: number | null,
  orderId: number
): Promise<{ audioUrl: string; audioKey: string }> {
  const apiKey = ELEVENLABS_API_KEY();
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured");
  }

  console.log(`[ElevenLabs] Generating TTS with voice ${voiceId} for text (${text.length} chars)`);

  const response = await axios.post(
    `${ELEVENLABS_BASE_URL}/text-to-speech/${voiceId}`,
    {
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.65,
        similarity_boost: 0.80,
        style: 0.35,
        use_speaker_boost: true,
      },
    },
    {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
      timeout: 60000,
    }
  );

  const audioBuffer = Buffer.from(response.data);
  if (audioBuffer.length === 0) {
    throw new Error("ElevenLabs returned empty audio");
  }

  // Upload to S3
  const ns = getStorageNamespace(userId, orderId);
  const fileKey = `${ns}/narration/${nanoid()}-elevenlabs-narration.mp3`;
  const { url: audioUrl } = await storagePut(fileKey, audioBuffer, "audio/mpeg");

  console.log(`[ElevenLabs] TTS generated successfully (${audioBuffer.length} bytes)`);

  return { audioUrl, audioKey: fileKey };
}

// ─── Edge TTS Fallback ──────────────────────────────────────────────────────

/**
 * Generate narration using Edge TTS (fallback when ElevenLabs is unavailable).
 */
async function generateWithEdgeTTS(
  text: string,
  userId: number | null,
  orderId: number,
  voice: string = DEFAULT_EDGE_VOICE
): Promise<{ audioUrl: string; audioKey: string }> {
  const rate = "-10%";
  const pitch = "+5Hz";

  console.log(`[EdgeTTS] Generating narration with voice ${voice} for text (${text.length} chars)`);

  const tts = new EdgeTTS(text, voice, { rate, pitch });
  const result = await tts.synthesize();

  if (!result.audio || result.audio.size === 0) {
    throw new Error("Edge TTS produced empty audio");
  }

  const audioBuffer = Buffer.from(await result.audio.arrayBuffer());

  const ns = getStorageNamespace(userId, orderId);
  const fileKey = `${ns}/narration/${nanoid()}-edge-narration.mp3`;
  const { url: audioUrl } = await storagePut(fileKey, audioBuffer, "audio/mpeg");

  console.log(`[EdgeTTS] Successfully generated narration (${audioBuffer.length} bytes)`);

  return { audioUrl, audioKey: fileKey };
}

// ─── Main Narration Function ────────────────────────────────────────────────

/**
 * Generate narration audio for a scene.
 * 
 * Priority:
 * 1. If elevenlabsVoiceId is provided (cloned voice), use ElevenLabs TTS with that voice
 * 2. If ElevenLabs API key exists but no cloned voice, use ElevenLabs default voice
 * 3. Fall back to Edge TTS with a cheerful voice
 */
export async function generateNarration(
  text: string,
  userId: number | null,
  orderId: number,
  options?: {
    elevenlabsVoiceId?: string;
    edgeVoice?: string;
  }
): Promise<{ audioUrl: string; audioKey: string }> {
  const apiKey = ELEVENLABS_API_KEY();

  // Priority 1: Use ElevenLabs with cloned voice
  if (options?.elevenlabsVoiceId && apiKey) {
    try {
      return await generateWithElevenLabs(text, options.elevenlabsVoiceId, userId, orderId);
    } catch (error) {
      console.warn(`[TTS] ElevenLabs cloned voice failed, trying default:`, error instanceof Error ? error.message : error);
    }
  }

  // Priority 2: Use ElevenLabs with default voice
  if (apiKey) {
    try {
      return await generateWithElevenLabs(text, ELEVENLABS_DEFAULT_VOICE_ID, userId, orderId);
    } catch (error) {
      console.warn(`[TTS] ElevenLabs default voice failed, falling back to Edge TTS:`, error instanceof Error ? error.message : error);
    }
  }

  // Priority 3: Fall back to Edge TTS
  return await generateWithEdgeTTS(text, userId, orderId, options?.edgeVoice || DEFAULT_EDGE_VOICE);
}

/**
 * Delete a cloned voice from ElevenLabs (cleanup).
 */
export async function deleteElevenLabsVoice(voiceId: string): Promise<boolean> {
  const apiKey = ELEVENLABS_API_KEY();
  if (!apiKey) return false;

  try {
    await axios.delete(`${ELEVENLABS_BASE_URL}/voices/${voiceId}`, {
      headers: { "xi-api-key": apiKey },
      timeout: 15000,
    });
    console.log(`[ElevenLabs] Voice ${voiceId} deleted`);
    return true;
  } catch (error) {
    console.warn(`[ElevenLabs] Failed to delete voice ${voiceId}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Get list of available voices for the frontend to display.
 */
export function getAvailableVoices() {
  return Object.entries(CHILDREN_STORY_VOICES).map(([id, info]) => ({
    id,
    ...info,
  }));
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageReadBytes: vi.fn(),
  storagePut: vi.fn(),
  axiosGet: vi.fn(),
  axiosPost: vi.fn(),
  axiosDelete: vi.fn(),
  axiosIsAxiosError: vi.fn(),
  formAppend: vi.fn(),
  formHeaders: vi.fn(),
  nanoid: vi.fn(),
}));

vi.mock("../storage", () => ({
  storageReadBytes: mocks.storageReadBytes,
  storagePut: mocks.storagePut,
}));
vi.mock("axios", () => ({
  default: {
    get: mocks.axiosGet,
    post: mocks.axiosPost,
    delete: mocks.axiosDelete,
    isAxiosError: mocks.axiosIsAxiosError,
  },
}));
vi.mock("form-data", () => ({
  default: class MockFormData {
    append(...args: unknown[]) {
      mocks.formAppend(...args);
    }

    getHeaders() {
      return mocks.formHeaders();
    }
  },
}));
vi.mock("nanoid", () => ({ nanoid: mocks.nanoid }));
vi.mock("edge-tts-universal", () => ({ EdgeTTS: class {} }));
vi.mock("./storageNamespace", () => ({ getStorageNamespace: vi.fn(() => "orders/22") }));

import { cloneVoiceWithElevenLabs, generateNarration } from "./ttsService";

describe("ttsService paid private-S3 voice repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ELEVENLABS_API_KEY", "offline-test-key");
    mocks.nanoid.mockReturnValue("abc123");
    mocks.formHeaders.mockReturnValue({ "content-type": "multipart/form-data; boundary=test" });
    mocks.axiosIsAxiosError.mockReturnValue(false);
    mocks.axiosPost.mockResolvedValue({ data: { voice_id: "cloned-private-voice" } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uploads SDK-read private sample bytes with their stored MIME type and never fetches its legacy URL", async () => {
    mocks.storageReadBytes.mockResolvedValue({
      key: "orders/22/voice/private.wav",
      data: Buffer.from("private-voice"),
      contentType: "audio/wav",
    });

    const voiceId = await cloneVoiceWithElevenLabs(
      "https://unsigned.invalid/private.wav",
      "Ari",
      "orders/22/voice/private.wav"
    );

    expect(voiceId).toBe("cloned-private-voice");
    expect(mocks.storageReadBytes).toHaveBeenCalledWith("orders/22/voice/private.wav");
    expect(mocks.axiosGet).not.toHaveBeenCalled();
    expect(mocks.formAppend).toHaveBeenCalledWith(
      "files",
      Buffer.from("private-voice"),
      { filename: "voice-sample.wav", contentType: "audio/wav" }
    );
    expect(mocks.axiosPost).toHaveBeenCalledWith(
      expect.stringContaining("/voices/add"),
      expect.anything(),
      expect.objectContaining({ headers: expect.objectContaining({ "xi-api-key": "offline-test-key" }) })
    );
  });

  it("returns the existing null/fallback signal without URL access when a canonical sample key cannot be read", async () => {
    mocks.storageReadBytes.mockRejectedValue(new Error("AccessDenied"));

    const voiceId = await cloneVoiceWithElevenLabs(
      "https://unsigned.invalid/private.webm",
      "Ari",
      "orders/22/voice/private.webm"
    );

    expect(voiceId).toBeNull();
    expect(mocks.axiosGet).not.toHaveBeenCalled();
    expect(mocks.axiosPost).not.toHaveBeenCalled();
  });

  it("retains URL download compatibility only when no canonical sample key exists", async () => {
    mocks.axiosGet.mockResolvedValue({
      data: Buffer.from("legacy-voice"),
      headers: { "content-type": "audio/ogg" },
    });

    const voiceId = await cloneVoiceWithElevenLabs(
      "https://legacy.invalid/voice.ogg",
      "Ari"
    );

    expect(voiceId).toBe("cloned-private-voice");
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(mocks.axiosGet).toHaveBeenCalledWith("https://legacy.invalid/voice.ogg", {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    expect(mocks.formAppend).toHaveBeenCalledWith(
      "files",
      Buffer.from("legacy-voice"),
      { filename: "voice-sample.ogg", contentType: "audio/ogg" }
    );
  });

  it("requires a configured cloned voice in strict custom-voice mode and never reaches fallback providers", async () => {
    await expect(generateNarration("A gentle hello.", 7, 22, {
      requireCustomVoice: true,
    })).rejects.toThrow("Custom voice narration is unavailable");

    expect(mocks.axiosPost).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("does not fall back to a stock or Edge voice when the selected custom voice fails", async () => {
    mocks.axiosPost.mockRejectedValue(new Error("quota exhausted"));

    await expect(generateNarration("A gentle hello.", 7, 22, {
      elevenlabsVoiceId: "saved-custom-voice",
      requireCustomVoice: true,
    })).rejects.toThrow("Custom voice narration failed");

    expect(mocks.axiosPost).toHaveBeenCalledTimes(1);
    expect(mocks.axiosPost).toHaveBeenCalledWith(
      expect.stringContaining("/text-to-speech/saved-custom-voice"),
      expect.anything(),
      expect.anything()
    );
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("uses only the supplied custom ElevenLabs voice when strict narration succeeds", async () => {
    mocks.axiosPost.mockResolvedValue({ data: Buffer.from("strict-custom-audio") });
    mocks.storagePut.mockResolvedValue({
      key: "orders/22/narration/custom.mp3",
      url: "https://metadata.invalid/custom.mp3",
    });

    await expect(generateNarration("A gentle hello.", 7, 22, {
      elevenlabsVoiceId: "saved-custom-voice",
      requireCustomVoice: true,
    })).resolves.toEqual({
      audioKey: "orders/22/narration/abc123-elevenlabs-narration.mp3",
      audioUrl: "https://metadata.invalid/custom.mp3",
    });

    expect(mocks.axiosPost).toHaveBeenCalledWith(
      expect.stringContaining("/text-to-speech/saved-custom-voice"),
      expect.objectContaining({ text: "A gentle hello." }),
      expect.anything()
    );
  });
});

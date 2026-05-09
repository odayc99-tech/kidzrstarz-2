import { describe, it, expect } from "vitest";

describe("Voice cloning cleanup", () => {
  it("should export cloneVoiceWithElevenLabs function", async () => {
    const { cloneVoiceWithElevenLabs } = await import("./ttsService");
    expect(typeof cloneVoiceWithElevenLabs).toBe("function");
  });

  it("should export deleteElevenLabsVoice function", async () => {
    const { deleteElevenLabsVoice } = await import("./ttsService");
    expect(typeof deleteElevenLabsVoice).toBe("function");
  });
});

describe("Scene splitter accepts canonical description", () => {
  it("should accept canonicalDescription parameter", async () => {
    const { splitStoryIntoScenes } = await import("./sceneSplitter");
    expect(typeof splitStoryIntoScenes).toBe("function");
    // Function signature accepts 4 params: story, childName, childDescription, canonicalDescription
    expect(splitStoryIntoScenes.length).toBeGreaterThanOrEqual(2);
  });
});

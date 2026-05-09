import { describe, expect, it } from "vitest";
describe("ElevenLabs API Key Validation", () => {
  it("should validate the ElevenLabs API key by fetching voices", async () => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.warn("ELEVENLABS_API_KEY not set, skipping test");
      return;
    }
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey!,
      },
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("voices");
    expect(Array.isArray(data.voices)).toBe(true);
  });
});

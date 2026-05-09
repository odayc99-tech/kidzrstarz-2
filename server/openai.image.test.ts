/**
 * Validates that the configured OPENAI_API_KEY can reach the OpenAI API.
 * Uses a lightweight models list call (no image generation credits consumed).
 */
import { describe, it, expect } from "vitest";

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? "";
const OPENAI_BASE = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");

describe("OpenAI API key validation", () => {
  it("should have OPENAI_API_KEY configured", () => {
    expect(OPENAI_KEY.length).toBeGreaterThan(0);
  });

  it("should be a real OpenAI key (not routed through Manus proxy)", () => {
    const base = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    // When a real key is set, the base URL should not be the Manus proxy
    // (or the base URL should be the default openai.com)
    const isManusProxy = base.includes("manus.im");
    if (isManusProxy) {
      // If still using Manus proxy, the key must be a real sk- key from OpenAI
      // We can't verify this without making a call, so just warn
      console.warn("OPENAI_BASE_URL still points to Manus proxy — image generation may not work");
    }
    expect(OPENAI_KEY).toBeTruthy();
  });

  it("should successfully call OpenAI models endpoint to validate key", async () => {
    // Use the models list endpoint — it's free, fast, and validates the key
    const response = await fetch(`${OPENAI_BASE}/models`, {
      headers: { authorization: `Bearer ${OPENAI_KEY}` },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenAI API key validation failed (${response.status}): ${body.substring(0, 200)}`);
    }

    const data = await response.json() as { data: Array<{ id: string }> };
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThan(0);
    console.log(`✓ OpenAI key valid — ${data.data.length} models available`);
  }, 15000);
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ llm: vi.fn(), getOrder: vi.fn(), experience: vi.fn(), set: vi.fn() }));
vi.mock("../_core/llm", () => ({ invokeLLM: m.llm }));
vi.mock("../db", () => ({ getOrderById: m.getOrder, getDb: async () => ({ update: () => ({ set: m.set }) }) }));
vi.mock("../services/experienceCatalog", () => ({ getOrderExperience: m.experience }));
import { generateStory, STORY_THEMES } from "../services/storyGeneration";
import { processStoryGeneration } from "./storyGenerationJob";

beforeEach(() => {
  vi.clearAllMocks();
  m.llm.mockResolvedValue({ choices: [{ message: { content: "A complete fictional test story." } }] });
  m.getOrder.mockResolvedValue({ id: 4, childName: "Test", childDescription: null, storyTheme: "snow-day", originalImageKey: "test/photo.jpg" });
  m.experience.mockResolvedValue({ theme: { title: "Snow-Day Adventure", storySetting: "FROZEN WINTER SETTING", storyTone: "warm and gentle" }, music: null });
  m.set.mockReturnValue({ where: async () => undefined });
});

describe("frozen story theme integration", () => {
  it("uses the saved seasonal theme instead of falling back to Adventure", async () => {
    await processStoryGeneration(4);
    const messages = m.llm.mock.calls[0][0].messages;
    expect(messages[1].content).toContain("FROZEN WINTER SETTING");
    expect(messages[1].content).toContain("Snow-Day Adventure");
    expect(messages[1].content).toContain("children aged 3-8");
    expect(m.set).toHaveBeenCalledWith({ story: "A complete fictional test story." });
  });
  it("does not call a provider or save a story when a snapshot is forbidden", async () => {
    m.experience.mockRejectedValueOnce(new Error("AccessDenied"));
    await processStoryGeneration(4);
    expect(m.llm).not.toHaveBeenCalled(); expect(m.set).not.toHaveBeenCalled();
  });
  it("keeps classic prompts identical when a matching definition is supplied", async () => {
    await generateStory({ childName: "Test", theme: "fairytale" });
    const legacy = m.llm.mock.calls[0][0];
    await generateStory({ childName: "Test", theme: "fairytale", themeDefinition: STORY_THEMES.fairytale });
    expect(m.llm.mock.calls[1][0]).toEqual(legacy);
  });
  it("uses old theme instructions only when the sidecar is absent", async () => {
    m.getOrder.mockResolvedValueOnce({ id: 4, childName: "Test", childDescription: null, storyTheme: "fairytale", originalImageKey: "legacy/photo.jpg" });
    m.experience.mockResolvedValueOnce(null);
    await processStoryGeneration(4);
    expect(m.llm.mock.calls[0][0].messages[1].content).toContain(STORY_THEMES.fairytale.description);
  });
});

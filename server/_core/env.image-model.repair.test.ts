import { afterEach, describe, expect, it, vi } from "vitest";

const originalOpenAiImageModel = process.env.OPENAI_IMAGE_MODEL;

async function loadImageModel(openAiImageModel: string | undefined) {
  if (openAiImageModel === undefined) {
    delete process.env.OPENAI_IMAGE_MODEL;
  } else {
    process.env.OPENAI_IMAGE_MODEL = openAiImageModel;
  }

  vi.resetModules();
  const { ENV } = await import("./env");
  return ENV.openAiImageModel;
}

afterEach(() => {
  if (originalOpenAiImageModel === undefined) {
    delete process.env.OPENAI_IMAGE_MODEL;
  } else {
    process.env.OPENAI_IMAGE_MODEL = originalOpenAiImageModel;
  }
  vi.resetModules();
});

describe("ENV.openAiImageModel repair", () => {
  it("uses gpt-image-2.5-sunburst when OPENAI_IMAGE_MODEL is unset", async () => {
    await expect(loadImageModel(undefined)).resolves.toBe("gpt-image-2.5-sunburst");
  });

  it("uses gpt-image-2.5-sunburst when OPENAI_IMAGE_MODEL is blank", async () => {
    await expect(loadImageModel("")).resolves.toBe("gpt-image-2.5-sunburst");
    await expect(loadImageModel(" \t\n ")).resolves.toBe("gpt-image-2.5-sunburst");
  });

  it("trims an explicit OPENAI_IMAGE_MODEL override", async () => {
    await expect(loadImageModel("  compatible-image-model  ")).resolves.toBe(
      "compatible-image-model"
    );
  });
});

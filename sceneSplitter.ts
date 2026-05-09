import { invokeLLM } from "../_core/llm";

export interface SceneData {
  sceneIndex: number;
  sceneText: string;
  illustrationPrompt: string;
}

export async function splitStoryIntoScenes(params: {
  story: string;
  characterDescription: string;
  theme: string;
  childName: string;
}): Promise<SceneData[]> {
  const { story, characterDescription, theme, childName } = params;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a storybook illustrator and scene director. Split stories into exactly 5 scenes for a children's storybook. Each scene needs narration text and a detailed illustration prompt.`,
      },
      {
        role: "user",
        content: `Split this children's story into exactly 5 scenes for a storybook. 

Story: "${story}"

Character description: ${characterDescription}
Theme: ${theme}
Child's name: ${childName}

For each scene, provide:
1. sceneText: 2-3 sentences of narration text for that scene (from the story)
2. illustrationPrompt: A detailed Pixar/Disney 3D animation style illustration prompt for that scene. Include the character appearance, setting, action, lighting, and mood. Always reference the character as "${childName}" and describe them consistently with: ${characterDescription}

Return ONLY valid JSON in this exact format:
[
  {
    "sceneIndex": 1,
    "sceneText": "narration text here",
    "illustrationPrompt": "detailed illustration prompt here"
  },
  ...5 scenes total
]`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "story_scenes",
        strict: true,
        schema: {
          type: "object",
          properties: {
            scenes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sceneIndex: { type: "integer" },
                  sceneText: { type: "string" },
                  illustrationPrompt: { type: "string" },
                },
                required: ["sceneIndex", "sceneText", "illustrationPrompt"],
                additionalProperties: false,
              },
            },
          },
          required: ["scenes"],
          additionalProperties: false,
        },
      },
    },
  });

  try {
    const content = response.choices?.[0]?.message?.content?.toString() || "{}";
    const parsed = JSON.parse(content);
    const scenes: SceneData[] = (parsed.scenes || []).slice(0, 5).map((s: SceneData, i: number) => ({
      sceneIndex: i + 1,
      sceneText: s.sceneText || "",
      illustrationPrompt: s.illustrationPrompt || "",
    }));

    // Ensure exactly 5 scenes
    while (scenes.length < 5) {
      scenes.push({
        sceneIndex: scenes.length + 1,
        sceneText: "The adventure continues...",
        illustrationPrompt: `Pixar 3D animation style, ${characterDescription}, ${theme} setting, warm lighting, cinematic`,
      });
    }

    return scenes;
  } catch (err) {
    console.error("[SceneSplitter] Failed to parse scenes:", err);
    // Return fallback scenes
    return Array.from({ length: 5 }, (_, i) => ({
      sceneIndex: i + 1,
      sceneText: story.split(".").slice(i * 2, i * 2 + 2).join(". ") || "The adventure continues...",
      illustrationPrompt: `Pixar 3D animation style, ${characterDescription}, ${theme} adventure setting, warm cinematic lighting`,
    }));
  }
}

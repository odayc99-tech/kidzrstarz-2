import { invokeLLM } from "../_core/llm";

export interface StoryScene {
  sceneIndex: number;
  sceneText: string;
  illustrationPrompt: string;
}

/**
 * Use LLM to split a story into 5 illustrated scenes.
 * Each scene gets narration text and an illustration prompt.
 * 
 * Character consistency is enforced by:
 * 1. Providing the canonical character description to the LLM
 * 2. Instructing the LLM to use ONLY scene-specific actions/settings in prompts
 * 3. The caller (videoGenerationJob) prepends the canonical description to each prompt
 * 
 * @param canonicalDescription - The exact character description extracted from the generated character image.
 *   This will be prepended to each illustration prompt by the caller, so the LLM should focus
 *   on scene-specific content (action, setting, mood, expression).
 */
export async function splitStoryIntoScenes(
  story: string,
  childName: string,
  childDescription?: string | null,
  canonicalDescription?: string
): Promise<StoryScene[]> {
  console.log(`[SceneSplitter] Splitting story into scenes for ${childName}`);

  // If we have a canonical description, tell the LLM to focus on scene-specific content
  // because we'll prepend the character description ourselves
  const characterGuidance = canonicalDescription
    ? `\nIMPORTANT: A canonical character description will be automatically prepended to each illustration prompt. 
Your illustrationPrompt should focus ONLY on the scene-specific content:
- What the character is DOING (action, pose, gesture)
- The character's EXPRESSION (happy, surprised, determined, etc.)
- The SETTING/BACKGROUND (forest, spaceship, underwater cave, etc.)
- The MOOD/LIGHTING (warm sunset, mysterious moonlight, bright cheerful, etc.)
- Any OTHER CHARACTERS or objects in the scene
- Style: "premium 3D cinematic animation style, vibrant colors, soft cinematic lighting, movie quality render"

Do NOT include character physical description (hair, eyes, skin, clothing) in the illustrationPrompt — that is handled separately.`
    : `\nEvery illustrationPrompt MUST begin with a detailed physical description of ${childName} (hair color, eye color, skin tone, clothing, build) that is IDENTICAL across all 5 scenes. After the character description, describe the specific scene.`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a children's storybook scene planner. Given a short children's story, split it into exactly 5 scenes for an animated storybook video.

For each scene, provide:
1. The narration text (1-3 sentences, read aloud to the child)
2. A detailed illustration prompt for generating a premium 3D cinematic animated image
${characterGuidance}`,
      },
      {
        role: "user",
        content: `Split this story about ${childName} into 5 scenes:

"${story}"

Return JSON array with exactly 5 scenes.`,
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
                  sceneIndex: { type: "integer", description: "Scene index starting from 0" },
                  sceneText: { type: "string", description: "Narration text for this scene" },
                  illustrationPrompt: { type: "string", description: "Image generation prompt for this scene" },
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

  const content = response.choices[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("LLM returned no content for scene splitting");
  }

  const parsed = JSON.parse(content);
  const scenes: StoryScene[] = parsed.scenes;

  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error("LLM returned invalid scenes array");
  }

  console.log(`[SceneSplitter] Successfully split story into ${scenes.length} scenes`);
  return scenes;
}

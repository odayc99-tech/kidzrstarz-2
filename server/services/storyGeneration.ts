import { invokeLLM } from "../_core/llm";

/**
 * Available story themes with descriptions for the LLM prompt.
 */
export const STORY_THEMES: Record<string, { label: string; description: string; tone: string }> = {
  adventure: {
    label: "Adventure",
    description: "An exciting quest through magical lands with challenges to overcome",
    tone: "thrilling, courageous, and wonder-filled",
  },
  fairytale: {
    label: "Fairy Tale",
    description: "A classic fairy tale with enchanted forests, magical creatures, and a happy ending",
    tone: "whimsical, enchanting, and dreamy",
  },
  space: {
    label: "Space Explorer",
    description: "A journey through the stars, visiting planets and meeting friendly aliens",
    tone: "awe-inspiring, curious, and cosmic",
  },
  underwater: {
    label: "Underwater World",
    description: "An ocean adventure with colorful sea creatures, coral reefs, and hidden treasures",
    tone: "playful, colorful, and magical",
  },
  superhero: {
    label: "Superhero",
    description: "Discovering special powers and using them to help friends and save the day",
    tone: "empowering, brave, and action-packed",
  },
  dinosaur: {
    label: "Dinosaur Land",
    description: "Traveling back in time to meet friendly dinosaurs and explore a prehistoric world",
    tone: "exciting, educational, and fun",
  },
  pirate: {
    label: "Pirate Treasure",
    description: "A swashbuckling voyage on the high seas searching for hidden treasure",
    tone: "adventurous, playful, and mysterious",
  },
  enchantedForest: {
    label: "Enchanted Forest",
    description: "Exploring a magical forest filled with talking animals, fairies, and secret paths",
    tone: "gentle, magical, and heartwarming",
  },
};

export interface StoryGenerationOptions {
  childName: string;
  characterDescription?: string;
  theme?: string;
}

/**
 * Generate a personalized 30-second story featuring the child's character.
 * Uses the selected theme to shape the story's setting, tone, and plot.
 */
export async function generateStory(options: StoryGenerationOptions): Promise<string> {
  const {
    childName,
    characterDescription = "a brave and curious child",
    theme = "adventure",
  } = options;

  const themeInfo = STORY_THEMES[theme] || STORY_THEMES.adventure;

  try {
    const prompt = `Create a fun, engaging 30-second children's story (approximately 100-150 words) featuring a character named "${childName}" who is ${characterDescription}.

STORY THEME: ${themeInfo.label}
Theme description: ${themeInfo.description}
Desired tone: ${themeInfo.tone}

The story should be:
- Set in a world that matches the "${themeInfo.label}" theme
- Age-appropriate and wholesome
- Exciting and imaginative with a ${themeInfo.tone} tone
- Include a small adventure or lesson that fits the theme
- Written in a narrative style suitable for children aged 3-8
- Use vivid, descriptive language that paints pictures in the listener's mind

STORY STRUCTURE (very important):
- Beginning: Introduce ${childName} and set the scene with energy and wonder
- Middle: A small adventure, challenge, or discovery that fits the theme
- Ending: The story MUST have a clear, satisfying conclusion. Write a warm, final closing sentence that wraps up the adventure — something like "And from that day on..." or "As the stars twinkled above..." or "${childName} smiled, knowing that...". The last sentence should feel like a gentle goodnight or a happy "The End" moment. Do NOT let the story trail off or end abruptly mid-thought.

Start the story directly without any preamble or introduction. Do not include "The End" as text — the final sentence itself should feel conclusive and complete.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a creative children's story writer specializing in ${themeInfo.label.toLowerCase()} stories. Create engaging, age-appropriate stories that children will love. Your stories should be vivid, imaginative, and perfectly capture the ${themeInfo.tone} tone. You always write stories with a clear beginning, middle, and a warm, satisfying conclusion — never leaving the ending hanging or trailing off.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    const story = typeof content === "string" ? content : "";

    if (!story || story.trim().length === 0) {
      throw new Error("Failed to generate story content");
    }

    return story.trim();
  } catch (error) {
    console.error("[Story Generation] Error generating story:", error);
    throw error;
  }
}

/**
 * Get available story themes for the frontend to display.
 */
export function getAvailableThemes() {
  return Object.entries(STORY_THEMES).map(([id, info]) => ({
    id,
    label: info.label,
    description: info.description,
  }));
}

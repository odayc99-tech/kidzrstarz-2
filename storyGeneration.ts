import { invokeLLM } from "../_core/llm";

export interface GeneratedStory {
  story: string;
  characterDescription: string;
}

export async function generateStory(params: {
  childName: string;
  childAge: string;
  theme: string;
  characterImageUrl: string;
}): Promise<GeneratedStory> {
  const { childName, childAge, theme, characterImageUrl } = params;

  const themeDescriptions: Record<string, string> = {
    adventure: "an exciting outdoor adventure with exploration and discovery",
    fairytale: "a magical fairytale kingdom with castles, dragons, and enchanted forests",
    space: "an intergalactic space adventure with rockets, planets, and alien friends",
    underwater: "an underwater ocean adventure with colorful fish, coral reefs, and sea creatures",
    superhero: "a superhero adventure where the child discovers and uses special powers to help others",
    dinosaur: "a prehistoric dinosaur world with friendly dinosaurs and ancient jungles",
    pirate: "a swashbuckling pirate adventure on the high seas with treasure maps and islands",
    enchantedForest: "a magical enchanted forest with fairies, talking animals, and hidden wonders",
  };

  const themeDesc = themeDescriptions[theme] || "a magical adventure";

  // First, get character description from the image
  const charResponse = await invokeLLM({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: characterImageUrl, detail: "high" },
          },
          {
            type: "text",
            text: `Describe this Pixar-style animated character in detail. Include their appearance, clothing, hair color, eye color, and any distinctive features. Keep it to 2-3 sentences for use as a character reference.`,
          },
        ],
      },
    ],
  });

  const characterDescription =
    charResponse.choices?.[0]?.message?.content?.toString() ||
    `A charming Pixar-style character with bright eyes and a warm smile`;

  // Generate the personalized story
  const storyResponse = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a children's storybook author who writes magical, age-appropriate stories in the style of Pixar movies. Stories should be warm, adventurous, and empowering. Write in simple language suitable for children aged 3-10.`,
      },
      {
        role: "user",
        content: `Write a short, magical children's story (about 200-250 words) featuring a child named ${childName} who is ${childAge} years old. The story is set in ${themeDesc}. The main character looks like this: ${characterDescription}. 

The story should:
- Start with an exciting opening that introduces ${childName}
- Have a clear adventure or challenge
- Show ${childName} being brave, creative, or kind
- End happily with a lesson or heartwarming moment
- Use vivid, imaginative descriptions

Write only the story text, no title needed.`,
      },
    ],
  });

  const story =
    storyResponse.choices?.[0]?.message?.content?.toString() ||
    `Once upon a time, ${childName} set off on the most magical adventure...`;

  return { story, characterDescription };
}

export const NARRATOR_AUDITION_MODEL = "eleven_multilingual_v2";

export const NARRATOR_AUDITION_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.8,
  style: 0,
  speed: 0.95,
  use_speaker_boost: true,
} as const;

export const NARRATOR_AUDITION_TEXT =
  "Mia found a tiny door at the bottom of a tree. Tap, tap, tap! A little fox peeked out. \"The moon has lost its sparkle,\" he said. Mia smiled and took a brave step onto the glowing path. Together, they would bring the sparkle back—one kind little adventure at a time.";

export const NARRATOR_AUDITION_PRESETS = [
  {
    id: "playful",
    name: "Jade",
    label: "Playful storyteller",
    description: "Upbeat and natural; a candidate for lively adventures.",
    voiceId: "g7LVvkPWALzPxOQbF6OE",
  },
  {
    id: "warm",
    name: "Darian",
    label: "Warm storyteller",
    description: "Warm and grounded; a candidate for reassuring magical stories.",
    voiceId: "gOupLcAkjEnguROwi4oS",
  },
  {
    id: "bedtime",
    name: "Talia",
    label: "Gentle bedtime storyteller",
    description: "Warm and soft; a candidate for quiet bedtime stories.",
    voiceId: "OZ0L6eISlOejga3XjDFt",
  },
] as const;

export type NarratorAuditionId = (typeof NARRATOR_AUDITION_PRESETS)[number]["id"];

export interface NarratorAuditionResult {
  id: NarratorAuditionId;
  name: string;
  label: string;
  url: string;
  fromCache: boolean;
  modelId: typeof NARRATOR_AUDITION_MODEL;
}

export const DEFAULT_VOICE_RETIREMENT_DATE = "December 31, 2026";

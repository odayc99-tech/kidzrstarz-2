export const THEME_ICON_VALUES = [
  "sparkles",
  "crown",
  "rocket",
  "fish",
  "shield",
  "bone",
  "anchor",
  "tree",
  "snowflake",
  "gift",
  "pumpkin",
] as const;

export type ThemeIcon = (typeof THEME_ICON_VALUES)[number];

export const THEME_COLOR_VALUES = [
  "amber",
  "pink",
  "indigo",
  "cyan",
  "red",
  "green",
  "yellow",
  "emerald",
] as const;

export type ThemeColor = (typeof THEME_COLOR_VALUES)[number];

export const MUSIC_PRESET_IDS = [
  "playful-adventure",
  "magical-wonder",
  "cozy-bedtime",
] as const;

export type MusicPresetId = (typeof MUSIC_PRESET_IDS)[number];

/** A selector value only; it is intentionally not a music preset or asset. */
export const NO_MUSIC_SELECTION = "none" as const;

export interface MusicPreset {
  id: MusicPresetId;
  label: string;
  description: string;
  assetPath: string;
  available: boolean;
}

/**
 * These approved original instrumental assets are bundled and versioned.
 * Retain earlier versions so existing frozen order soundtracks remain valid.
 */
export const MUSIC_PRESETS: readonly MusicPreset[] = [
  {
    id: "playful-adventure",
    label: "Playful Adventure",
    description: "A bright, bouncy instrumental for joyful discoveries.",
    assetPath: "/audio/kidzrstarz/playful-adventure-v1.mp3",
    available: true,
  },
  {
    id: "magical-wonder",
    label: "Magical Wonder",
    description: "A gentle, sparkling instrumental for enchanted moments.",
    assetPath: "/audio/kidzrstarz/magical-wonder-v1.mp3",
    available: true,
  },
  {
    id: "cozy-bedtime",
    label: "Cozy Bedtime",
    description: "A soft, calming instrumental for a warm ending.",
    assetPath: "/audio/kidzrstarz/cozy-bedtime-v1.mp3",
    available: true,
  },
] as const;

export const MUSIC_GAIN = 0.12 as const;

export interface ThemeDefinition {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: ThemeIcon;
  color: ThemeColor;
  /** Private story-generation setting. Never return this from public discovery. */
  storySetting: string;
  /** Private story-generation tone. Never return this from public discovery. */
  storyTone: string;
  /** A fixed preset ID, or null when the theme intentionally defaults to no music. */
  defaultMusicId: MusicPresetId | null;
  featured: boolean;
  sortOrder: number;
  published: boolean;
}

/** Safe display fields for customer-visible theme discovery. */
export interface PublicTheme {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: ThemeIcon;
  color: ThemeColor;
  defaultMusicId: MusicPresetId | null;
  featured: boolean;
  sortOrder: number;
  /** Omitted by the server public projection; optional for compatible consumers. */
  published?: boolean;
}

/** A frozen, server-selected music setting saved with an individual order. */
export interface MusicSelection {
  id: MusicPresetId;
  label: string;
  assetPath: string;
  volume: typeof MUSIC_GAIN;
}

/** Immutable sidecar content for a newly created order. */
export interface OrderExperienceSnapshot {
  version: 1;
  theme: ThemeDefinition;
  music: MusicSelection | null;
  createdAtIso: string;
}

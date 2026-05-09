/**
 * Background music tracks mapped to each story theme.
 * Each track is a ~60-second instrumental loop designed to play
 * softly behind narration at reduced volume.
 */
export const THEME_BGM: Record<string, { url: string; label: string }> = {
  adventure: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-adventure_0b3662ac.mp3",
    label: "Adventure",
  },
  fairytale: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-fairytale_4dc7c904.mp3",
    label: "Fairy Tale",
  },
  space: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-space_311fe957.mp3",
    label: "Space Explorer",
  },
  underwater: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-underwater_5b080e17.mp3",
    label: "Underwater World",
  },
  superhero: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-superhero_1f4aad97.mp3",
    label: "Superhero",
  },
  dinosaur: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-dinosaur_bef1e869.mp3",
    label: "Dinosaur Land",
  },
  pirate: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-pirate_af20f17e.mp3",
    label: "Pirate Treasure",
  },
  enchantedForest: {
    url: "https://d2xsxph8kpxj0f.cloudfront.net/310519663488009170/4GL2mPjHtW2yMjS2aSQkPm/bgm-enchantedForest_35681286.mp3",
    label: "Enchanted Forest",
  },
};

/** Default BGM volume relative to narration (0.0 - 1.0). Set low so it never overpowers the narrator. */
export const DEFAULT_BGM_VOLUME = 0.15;

/** Minimum and maximum BGM volume for the slider */
export const MIN_BGM_VOLUME = 0;
export const MAX_BGM_VOLUME = 0.35;

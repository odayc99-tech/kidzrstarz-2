import { getOrderExperience as readSavedExperience } from "./experienceCatalog";
import type { OrderExperienceSnapshot } from "../../shared/experienceCatalog";

export { MUSIC_GAIN } from "../../shared/experienceCatalog";
export type { MusicSelection, OrderExperienceSnapshot, ThemeDefinition } from "../../shared/experienceCatalog";
export { ORDER_EXPERIENCE_SUFFIX } from "./experienceCatalog";

/** Only versioned bundled assets may be used by the server composer. */
export const TRUSTED_MUSIC_ASSET_PATH =
  /^\/audio\/kidzrstarz\/[A-Za-z0-9][A-Za-z0-9_-]*-v[0-9]+\.mp3$/;

/** Use one authoritative parser/cache for API, stories, videos, and voice recovery. */
export async function getOrderExperience(
  originalImageKey: string | null | undefined,
  storyTheme: string | null | undefined
): Promise<OrderExperienceSnapshot | null> {
  if (!originalImageKey) return null;
  return readSavedExperience({ originalImageKey, storyTheme: storyTheme || "adventure" });
}

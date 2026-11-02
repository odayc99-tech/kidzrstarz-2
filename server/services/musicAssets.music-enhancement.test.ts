import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  MusicSelection,
  OrderExperienceSnapshot,
} from "../../shared/experienceCatalog";

const mocks = vi.hoisted(() => ({
  storageReadBytes: vi.fn(),
  savedExperience: vi.fn(),
  exec: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  copyFile: vi.fn(),
  access: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("../storage", () => ({ storageReadBytes: mocks.storageReadBytes }));
vi.mock("./experienceCatalog", () => ({ getOrderExperience: mocks.savedExperience, ORDER_EXPERIENCE_SUFFIX: ".experience.json" }));
vi.mock("child_process", () => ({ exec: mocks.exec }));
vi.mock("fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  readFile: mocks.readFile,
  copyFile: mocks.copyFile,
  access: mocks.access,
  rm: mocks.rm,
}));

import {
  getOrderExperience,
  MUSIC_GAIN,
} from "./musicAssets";
import {
  composeStorybookVideo,
  trustedMusicFilePath,
} from "./videoComposition";
import { StoryPlayer } from "../../client/src/components/StoryPlayer";

const theme = {
  id: "adventure",
  title: "Adventure",
  description: "A bright adventure.",
  category: "Adventure",
  icon: "sparkles",
  color: "amber",
  storySetting: "A sunny meadow",
  storyTone: "Warm and playful",
  defaultMusicId: "playful-adventure",
  featured: true,
  sortOrder: 1,
  published: true,
} as const;

const selectedMusic: MusicSelection = {
  id: "playful-adventure",
  label: "Playful Adventure",
  assetPath: "/audio/kidzrstarz/playful-adventure-v1.mp3",
  volume: MUSIC_GAIN,
};

const selectedSnapshot: OrderExperienceSnapshot = {
  version: 1,
  theme: { ...theme },
  music: { ...selectedMusic },
  createdAtIso: "2026-11-02T00:00:00.000Z",
};

function successfulExec() {
  mocks.exec.mockImplementation(
    (
      _command: string,
      options: unknown,
      callback?: (
        error: Error | null,
        result: { stdout: string; stderr: string }
      ) => void
    ) => {
      const done =
        typeof options === "function"
          ? (options as (
              error: Error | null,
              result: { stdout: string; stderr: string }
            ) => void)
          : callback!;
      done(null, { stdout: "4.0", stderr: "" });
    }
  );
}

function completedScene() {
  return {
    sceneIndex: 0,
    illustrationKey: "orders/22/scenes/private.png",
    narrationKey: "orders/22/narration/private.mp3",
  };
}

function renderPlayer(props: Partial<Parameters<typeof StoryPlayer>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(StoryPlayer, {
      childName: "Ari",
      storyTheme: "adventure",
      scenes: [
        {
          id: 1,
          sceneIndex: 0,
          sceneText: "Ari finds a star.",
          illustrationUrl: "https://signed.invalid/scene.png",
          narrationUrl: null,
          status: "completed",
        },
      ],
      ...props,
    })
  );
}

describe("music enhancement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.savedExperience.mockReset().mockResolvedValue(null);
    mocks.mkdtemp.mockResolvedValue("/tmp/music-enhancement");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from("final-video"));
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.access.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.storageReadBytes.mockImplementation(async (key: string) => ({
      key,
      data: Buffer.from(key),
      contentType: key.includes("narration") ? "audio/mpeg" : "image/png",
    }));
    successfulExec();
  });

  afterEach(() => vi.unstubAllGlobals());

  it("uses the same immutable snapshot repository as API/story generation", async () => {
    mocks.savedExperience.mockResolvedValueOnce(selectedSnapshot);
    await expect(getOrderExperience("orders/22/original.png", "space")).resolves.toEqual(selectedSnapshot);
    expect(mocks.savedExperience).toHaveBeenCalledWith({ originalImageKey: "orders/22/original.png", storyTheme: "space" });
    mocks.savedExperience.mockResolvedValueOnce(null);
    await expect(getOrderExperience("orders/22/legacy.png", "adventure")).resolves.toBeNull();
    mocks.savedExperience.mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(getOrderExperience("orders/22/protected.png", "adventure")).rejects.toThrow("AccessDenied");
    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
  });

  it("mixes a selected snapshot from only its trusted local asset with low gain, fades, and narration ducking", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await composeStorybookVideo([completedScene()], "space", selectedMusic);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenCalledWith(
      expect.stringMatching(
        /client\/public\/audio\/kidzrstarz\/playful-adventure-v1\.mp3$/
      )
    );
    expect(mocks.copyFile).toHaveBeenCalledWith(
      expect.stringMatching(
        /client\/public\/audio\/kidzrstarz\/playful-adventure-v1\.mp3$/
      ),
      "/tmp/music-enhancement/saved-bgm.mp3"
    );
    const mixCommand = mocks.exec.mock.calls
      .map(([command]) => String(command))
      .find(command => command.includes("sidechaincompress"));
    expect(mixCommand).toContain("volume=0.12");
    expect(mixCommand).toContain("afade=t=in");
    expect(mixCommand).toContain("afade=t=out");
    expect(mixCommand).toContain("sidechaincompress");
    expect(mixCommand).toContain("amix=inputs=2:duration=first");
    expect(mixCommand).toContain("alimiter=limit=0.95");
  });

  it("uses no network or music file when a saved snapshot intentionally selects no music", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await composeStorybookVideo([completedScene()], "adventure", null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/tmp/music-enhancement/concat.mp4",
      "/tmp/music-enhancement/final_storybook.mp4"
    );
  });

  it("retains the legacy CDN no-music fallback only when the selection argument is undefined", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await composeStorybookVideo([completedScene()], "space");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("bgm-space")
    );
    expect(mocks.access).not.toHaveBeenCalled();
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/tmp/music-enhancement/concat.mp4",
      "/tmp/music-enhancement/final_storybook.mp4"
    );
  });

  it("rejects traversal and URL paths, and cleans private temporary assets after a saved-track failure", async () => {
    expect(() =>
      trustedMusicFilePath("/audio/kidzrstarz/../outside-v1.mp3")
    ).toThrow("not trusted");
    expect(() =>
      trustedMusicFilePath("https://untrusted.invalid/music.mp3")
    ).toThrow("not trusted");
    mocks.access.mockRejectedValueOnce(new Error("licensed file missing"));
    vi.stubGlobal("fetch", vi.fn());

    await expect(
      composeStorybookVideo([completedScene()], "adventure", selectedMusic)
    ).rejects.toThrow("licensed file missing");

    expect(mocks.rm).toHaveBeenCalledWith("/tmp/music-enhancement", {
      recursive: true,
      force: true,
    });
  });

  it("renders accurate music states on the server without constructing browser audio", () => {
    const AudioConstructor = vi.fn();
    vi.stubGlobal("Audio", AudioConstructor);

    expect(renderPlayer({ musicSelection: selectedMusic })).toContain(
      "Music will load when story playback starts."
    );
    expect(renderPlayer({ musicSelection: null })).toContain(
      "No music selected."
    );
    expect(
      renderPlayer({ musicError: "Music is temporarily unavailable." })
    ).toContain("Music is temporarily unavailable.");
    expect(AudioConstructor).not.toHaveBeenCalled();
  });
});

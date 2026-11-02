import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageReadBytes: vi.fn(),
  exec: vi.fn(),
  mkdtemp: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  copyFile: vi.fn(),
  rm: vi.fn(),
}));

vi.mock("../storage", () => ({ storageReadBytes: mocks.storageReadBytes }));
vi.mock("child_process", () => ({ exec: mocks.exec }));
vi.mock("fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  writeFile: mocks.writeFile,
  readFile: mocks.readFile,
  copyFile: mocks.copyFile,
  rm: mocks.rm,
}));

import { composeStorybookVideo } from "./videoComposition";

function successfulExec() {
  mocks.exec.mockImplementation((
    _command: string,
    options: unknown,
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void
  ) => {
    const done = typeof options === "function"
      ? options as (error: Error | null, result: { stdout: string; stderr: string }) => void
      : callback!;
    done(null, { stdout: "4.0", stderr: "" });
  });
}

function okResponse(bytes = "cdn-bgm") {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(bytes),
  };
}

describe("videoComposition paid private-S3 repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mkdtemp.mockResolvedValue("/tmp/storybook-private-test");
    mocks.writeFile.mockResolvedValue(undefined);
    mocks.readFile.mockResolvedValue(Buffer.from("final-video"));
    mocks.copyFile.mockResolvedValue(undefined);
    mocks.rm.mockResolvedValue(undefined);
    mocks.storageReadBytes.mockImplementation(async (key: string) => ({
      key,
      data: Buffer.from(key),
      contentType: key.includes("audio") ? "audio/mpeg" : "image/png",
    }));
    successfulExec();
  });

  it("reads private illustration and narration keys via storage SDK instead of their legacy URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await composeStorybookVideo([
      {
        sceneIndex: 2,
        illustrationKey: "orders/22/scenes/private.png",
        illustrationUrl: "https://unsigned.invalid/private.png",
        narrationKey: "orders/22/narration/private.mp3",
        narrationUrl: "https://unsigned.invalid/private.mp3",
      },
    ], "adventure");

    expect(result).toEqual(Buffer.from("final-video"));
    expect(mocks.storageReadBytes).toHaveBeenCalledWith("orders/22/scenes/private.png");
    expect(mocks.storageReadBytes).toHaveBeenCalledWith("orders/22/narration/private.mp3");
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/tmp/storybook-private-test/scene_2.png",
      Buffer.from("orders/22/scenes/private.png")
    );
    expect(mocks.writeFile).toHaveBeenCalledWith(
      "/tmp/storybook-private-test/narration_2.mp3",
      Buffer.from("orders/22/narration/private.mp3")
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("bgm-adventure");
    vi.unstubAllGlobals();
  });

  it("does not fall back to an illustration URL when the supplied private key cannot be read", async () => {
    mocks.storageReadBytes.mockRejectedValue(new Error("AccessDenied"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(composeStorybookVideo([
      {
        sceneIndex: 0,
        illustrationKey: "orders/22/scenes/private.png",
        illustrationUrl: "https://unsigned.invalid/private.png",
      },
    ], "adventure")).rejects.toThrow("AccessDenied");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/storybook-private-test", { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it("retains the graceful no-music fallback when the external BGM URL is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);

    await composeStorybookVideo([
      {
        sceneIndex: 0,
        illustrationKey: "orders/22/scenes/private.png",
      },
    ], "space");

    expect(mocks.storageReadBytes).toHaveBeenCalledWith("orders/22/scenes/private.png");
    expect(mocks.copyFile).toHaveBeenCalledWith(
      "/tmp/storybook-private-test/concat.mp4",
      "/tmp/storybook-private-test/final_storybook.mp4"
    );
    vi.unstubAllGlobals();
  });

  it("uses URL download only for a legacy URL-only scene record", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("legacy-image"));
    vi.stubGlobal("fetch", fetchMock);

    await composeStorybookVideo([
      {
        sceneIndex: 0,
        illustrationUrl: "https://legacy.invalid/scene.png",
      },
    ], "adventure");

    expect(mocks.storageReadBytes).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][0]).toBe("https://legacy.invalid/scene.png");
    vi.unstubAllGlobals();
  });

  it("exports narrated and silent clips in standard H.264 4:2:0 with fast-start metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
    await composeStorybookVideo([
      { sceneIndex: 0, illustrationKey: "7/scene.png", narrationKey: "7/audio.mp3" },
      { sceneIndex: 1, illustrationKey: "7/silent.png" },
    ], "adventure");
    const commands = mocks.exec.mock.calls.map(call => String(call[0]));
    const clipCommands = commands.filter(command => command.includes("-c:v libx264"));
    expect(clipCommands).toHaveLength(2);
    for (const command of clipCommands) {
      expect(command).toContain("-pix_fmt yuv420p");
      expect(command).toContain("-profile:v high -level:v 4.1");
      expect(command).toContain("-c:a aac");
      expect(command).toContain("-movflags +faststart");
    }
    expect(commands.find(command => command.includes("-f concat"))).toContain("-movflags +faststart");
    vi.unstubAllGlobals();
  });
});

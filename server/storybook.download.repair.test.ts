import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: {} as any,
  scenes: [] as any[],
  refetchOrder: vi.fn(),
  refetchScenes: vi.fn(),
  mutate: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 7 },
    isAuthenticated: true,
    loading: false,
    openSignIn: vi.fn(),
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    orders: {
      getOrder: {
        useQuery: () => ({
          data: mocks.order,
          isLoading: false,
          error: null,
          refetch: mocks.refetchOrder,
        }),
      },
      getScenes: {
        useQuery: () => ({
          data: mocks.scenes,
          isLoading: false,
          refetch: mocks.refetchScenes,
        }),
      },
      triggerVideoGeneration: { useMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false }) },
      regenerateStorybookStory: { useMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false }) },
      generateShareLink: { useMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false }) },
      getCharacterDownloadUrl: { useMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false }) },
      getVideoDownloadUrl: { useMutation: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutate, isPending: false }) },
    },
  },
}));
vi.mock("wouter", () => ({
  useSearch: () => "?orderId=22",
  Link: (props: any) => React.createElement("a", { href: props.href }, props.children),
}));
vi.mock("@/lib/guestToken", () => ({ getGuestToken: () => null, saveGuestToken: vi.fn() }));
vi.mock("@/lib/downloadFile", () => ({ downloadFile: mocks.downloadFile }));
vi.mock("@/components/StoryPlayer", () => ({ StoryPlayer: () => null }));
vi.mock("@/components/ui/button", () => ({
  Button: (props: any) => React.createElement("button", { disabled: props.disabled }, props.children),
}));
vi.mock("@/components/ui/card", () => ({
  Card: (props: any) => React.createElement("div", {}, props.children),
  CardContent: (props: any) => React.createElement("div", {}, props.children),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import Storybook from "../client/src/pages/Storybook";

const storybookSource = readFileSync(
  new URL("../client/src/pages/Storybook.tsx", import.meta.url),
  "utf8"
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  mocks.order = {
    id: 22,
    childName: "Mock child",
    paymentStatus: "paid",
    generatedImageUrl: null,
    videoKey: null,
    // A stale or separately available viewing URL must not make the MP4 downloadable.
    videoUrl: "https://signed.example.invalid/story.mp4",
    videoAccessError: null,
  };
  mocks.scenes = [{ id: 1, status: "completed", illustrationUrl: "https://signed.example.invalid/scene.png" }];
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("storybook MP4 download readiness", () => {
  it("keeps completed scenes in a disabled preparation state until the canonical video key exists", () => {
    const html = renderToStaticMarkup(React.createElement(Storybook));

    expect(html).toContain("Preparing MP4");
    expect(html).toContain("Final MP4 preparation is in progress.");
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).not.toContain("Download MP4");
  });

  it("offers Download MP4 from videoKey even when the viewing URL is temporarily unavailable", () => {
    mocks.order = {
      ...mocks.order,
      videoKey: "orders/22/videos/story.mp4",
      videoUrl: null,
      videoAccessError: "This video is temporarily unavailable. Please refresh to try again.",
    };

    const html = renderToStaticMarkup(React.createElement(Storybook));

    expect(html).toContain("Download MP4");
    expect(html).toContain("MP4 with narration &amp; music");
    expect(html).toContain("You can still download the completed MP4.");
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("uses the shared downloader and keeps browser composition out of the video download handler", () => {
    const handler = storybookSource.slice(
      storybookSource.indexOf("const handleDownloadVideo"),
      storybookSource.indexOf("const handleRegenerate")
    );

    expect(storybookSource).toContain('import { downloadFile } from "@/lib/downloadFile";');
    expect(handler).toContain("if (!order?.videoKey)");
    expect(handler).toContain("getVideoDownloadUrl.mutateAsync");
    expect(handler).toContain("await downloadFile(downloadUrl, filename)");
    expect(handler).not.toMatch(/composeVideoInBrowser|videoComposer|THEME_BGM|DEFAULT_BGM_VOLUME|videoBlob|URL\.createObjectURL|\.webm/i);
  });
});

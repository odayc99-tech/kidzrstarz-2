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
  retryNarration: vi.fn(),
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
      retryOwnNarration: { useMutation: () => ({ mutate: mocks.retryNarration, isPending: false }) },
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

const renderStorybook = () => renderToStaticMarkup(React.createElement(Storybook));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
  mocks.order = {
    id: 22,
    childName: "Mock child",
    paymentStatus: "paid",
    status: "completed",
    storyApproved: true,
    voiceSampleKey: "orders/22/voice.webm",
    voiceSampleUrl: "https://signed.example.invalid/voice.webm",
    narrationRetryPending: false,
    narrationRetryError: null,
    videoGenerating: false,
    generatedImageUrl: null,
    videoKey: "orders/22/videos/story.mp4",
    videoUrl: "https://signed.example.invalid/story.mp4",
    videoAccessError: null,
  };
  mocks.scenes = [{ id: 1, status: "completed", illustrationUrl: "https://signed.example.invalid/scene.png" }];
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("storybook saved-recording narration retry", () => {
  it("never starts a narration retry while the owned Storybook SSR renders", () => {
    const html = renderStorybook();

    expect(html).toContain("Retry My Voice");
    expect(mocks.retryNarration).not.toHaveBeenCalled();
  });

  it("shows the control only for a paid, approved story with a saved recording", () => {
    expect(renderStorybook()).toContain("Retry My Voice");

    mocks.order = { ...mocks.order, voiceSampleKey: null, voiceSampleUrl: null };
    expect(renderStorybook()).not.toContain("Retry My Voice");

    mocks.order = { ...mocks.order, paymentStatus: "unpaid", voiceSampleKey: "orders/22/voice.webm" };
    expect(renderStorybook()).not.toContain("Retry My Voice");

    mocks.order = { ...mocks.order, paymentStatus: "paid", storyApproved: false };
    expect(renderStorybook()).not.toContain("Retry My Voice");
  });

  it("keeps the retry control visible but disabled until the canonical MP4 key is ready", () => {
    mocks.order = { ...mocks.order, videoKey: null, videoUrl: "https://signed.example.invalid/stale.mp4" };

    const html = renderStorybook();

    expect(html).toContain("Waiting for the current MP4 to finish.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Retry My Voice<\/button>/);
    expect(mocks.retryNarration).not.toHaveBeenCalled();
  });

  it("reports an in-progress narration update while leaving the current MP4 available", () => {
    mocks.order = { ...mocks.order, narrationRetryPending: true };

    const html = renderStorybook();

    expect(html).toContain("Narration update in progress");
    expect(html).toContain("Your existing video and downloads remain available while the replacement is being prepared.");
    expect(html).toContain("Download MP4");
    expect(mocks.retryNarration).not.toHaveBeenCalled();
  });

  it("requires the ElevenLabs confirmation and only sends the explicit confirmed guest-capable mutation", () => {
    const retryMutation = storybookSource.slice(
      storybookSource.indexOf("const retryOwnNarration"),
      storybookSource.indexOf("// Share link")
    );
    const retryHandler = storybookSource.slice(
      storybookSource.indexOf("const handleRetryOwnNarration"),
      storybookSource.indexOf("// Auth loading")
    );
    const retryPanel = storybookSource.slice(
      storybookSource.indexOf("Uses ElevenLabs credits"),
      storybookSource.indexOf("{/* Download Section")
    );

    expect(retryPanel).toContain("Uses ElevenLabs credits to replace narration using your saved recording. The story/images and payment are unchanged; current video stays available until replacement is ready.");
    expect(retryPanel).toContain("Use My Voice");
    expect(retryPanel).toContain("onClick={handleRetryOwnNarration}");
    expect(retryPanel).toContain("onClick={() => setShowNarrationRetryConfirm(false)}");
    expect(retryHandler).toContain("retryOwnNarration.mutate({");
    expect(retryHandler).toContain("guestToken: guestToken || undefined");
    expect(retryHandler).toContain("confirm: true");
    expect(retryMutation).toContain("await refetchOrder()");
    expect(retryMutation).toContain("toast.info(");
    expect(retryMutation).not.toContain("toast.success(");
  });

  it("preserves the server-MP4-only download readiness behavior", () => {
    mocks.order = { ...mocks.order, videoKey: null, videoUrl: "https://signed.example.invalid/stale.mp4" };

    const html = renderStorybook();

    expect(html).toContain("Preparing MP4");
    expect(html).toContain("Final MP4 preparation is in progress.");
    expect(html).not.toContain("Download MP4");
    expect(storybookSource).toContain("if (!order?.videoKey)");
    expect(storybookSource).toContain("getVideoDownloadUrl.mutateAsync");
  });
});

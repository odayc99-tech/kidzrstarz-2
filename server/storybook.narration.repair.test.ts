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

describe("storybook saved-recording narration recovery removal", () => {
  it("does not expose retry controls, confirmation text, or recovery hooks for a paid recorded story", () => {
    const html = renderStorybook();

    expect(html).not.toContain("Retry My Voice");
    expect(html).not.toContain("Use My Voice");
    expect(html).not.toContain("Uses ElevenLabs credits");
    expect(mocks.retryNarration).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(storybookSource).not.toContain("retryOwnNarration");
    expect(storybookSource).not.toContain("handleRetryOwnNarration");
    expect(storybookSource).not.toContain("showNarrationRetryConfirm");
    expect(storybookSource).not.toContain("setShowNarrationRetryConfirm");
    expect(storybookSource).not.toMatch(/\bMic\b/);
    expect(storybookSource).not.toContain("ElevenLabs");
  });

  it("keeps retry and confirmation UI absent in every former eligibility state", () => {
    const formerlyEligibleVariants = [
      { voiceSampleKey: null, voiceSampleUrl: null },
      { paymentStatus: "unpaid", voiceSampleKey: "orders/22/voice.webm" },
      { paymentStatus: "paid", storyApproved: false },
      { narrationRetryPending: true },
    ];

    for (const variant of formerlyEligibleVariants) {
      mocks.order = { ...mocks.order, ...variant };
      const html = renderStorybook();

      expect(html).not.toContain("Retry My Voice");
      expect(html).not.toContain("Use My Voice");
      expect(html).not.toContain("Uses ElevenLabs credits");
    }

    expect(mocks.retryNarration).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("retains the narration-pending regeneration guard without starting recovery work during SSR", () => {
    mocks.order = { ...mocks.order, narrationRetryPending: true };

    const html = renderStorybook();

    expect(storybookSource).toContain(
      "const narrationRetryInProgress = Boolean(order?.narrationRetryPending)"
    );
    expect(html).not.toContain("Retry My Voice");
    expect(html).not.toContain("Use My Voice");
    expect(mocks.retryNarration).not.toHaveBeenCalled();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it("preserves the server-MP4-only download readiness behavior", () => {
    expect(renderStorybook()).toContain("Download MP4");

    mocks.order = { ...mocks.order, videoKey: null, videoUrl: "https://signed.example.invalid/stale.mp4" };

    const html = renderStorybook();

    expect(html).toContain("Preparing MP4");
    expect(html).toContain("Final MP4 preparation is in progress.");
    expect(html).not.toContain("Download MP4");
    expect(storybookSource).toContain("if (!order?.videoKey)");
    expect(storybookSource).toContain("getVideoDownloadUrl.mutateAsync");
  });
});

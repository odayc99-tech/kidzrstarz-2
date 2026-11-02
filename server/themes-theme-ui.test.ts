import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as { role: string } | null,
    isAuthenticated: false,
    loading: false,
    openSignIn: vi.fn(),
  },
  adminQuery: {
    data: undefined as any,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  publicQuery: {
    data: undefined as any,
    isLoading: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  adminQueryCalls: [] as unknown[][],
  publicQueryCalls: [] as unknown[][],
  mutate: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    themes: {
      listAdmin: {
        useQuery: (...args: unknown[]) => {
          mocks.adminQueryCalls.push(args);
          return mocks.adminQuery;
        },
      },
      listPublic: {
        useQuery: (...args: unknown[]) => {
          mocks.publicQueryCalls.push(args);
          return mocks.publicQuery;
        },
      },
      save: {
        useMutation: () => ({ mutateAsync: mocks.mutate, isPending: false }),
      },
      setPublished: {
        useMutation: () => ({ mutateAsync: mocks.mutate, isPending: false }),
      },
      reorder: {
        useMutation: () => ({ mutateAsync: mocks.mutate, isPending: false }),
      },
    },
    orders: {
      createOrder: {
        useMutation: () => ({ mutateAsync: mocks.mutate, isPending: false }),
      },
      uploadVoiceSample: {
        useMutation: () => ({ mutate: mocks.mutate, isPending: false }),
      },
    },
  },
}));
vi.mock("wouter", () => ({
  Link: (props: any) =>
    React.createElement("a", { href: props.href }, props.children),
  useLocation: () => ["/upload", vi.fn()],
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) =>
    React.createElement("button", props, children),
}));
vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: any) =>
    React.createElement("section", props, children),
  CardContent: ({ children, ...props }: any) =>
    React.createElement("div", props, children),
  CardHeader: ({ children, ...props }: any) =>
    React.createElement("header", props, children),
  CardTitle: ({ children, ...props }: any) =>
    React.createElement("h2", props, children),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => React.createElement("input", props),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) =>
    React.createElement("label", props, children),
}));
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => React.createElement("textarea", props),
}));
vi.mock("@/components/ui/switch", () => ({
  Switch: (props: any) => React.createElement("button", props),
}));
vi.mock("@/components/ProgressBar", () => ({ ProgressBar: () => null }));
vi.mock("@/lib/guestToken", () => ({ saveGuestToken: vi.fn() }));
vi.mock("@/lib/imageCompression", () => ({
  compressImage: vi.fn(),
  formatBytes: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AdminThemes from "../client/src/pages/AdminThemes";
import Upload from "../client/src/pages/Upload";
import { ThemeMusicPicker } from "../client/src/components/ThemeMusicPicker";

const music = [
  {
    id: "playful-adventure",
    label: "Playful Adventure",
    description: "Bright instrumental",
    assetPath: "/audio/kidzrstarz/playful-adventure-v1.mp3",
    available: true,
  },
  {
    id: "magical-wonder",
    label: "Magical Wonder",
    description: "Sparkling instrumental",
    assetPath: "/audio/kidzrstarz/magical-wonder-v1.mp3",
    available: false,
  },
] as any;
const adminTheme = {
  id: "adventure",
  title: "Adventure",
  description: "A bright quest.",
  category: "adventure",
  icon: "sparkles",
  color: "amber",
  storySetting: "PRIVATE SETTING",
  storyTone: "PRIVATE TONE",
  defaultMusicId: "playful-adventure",
  featured: true,
  sortOrder: 0,
  published: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  mocks.auth = {
    user: null,
    isAuthenticated: false,
    loading: false,
    openSignIn: vi.fn(),
  };
  mocks.adminQuery = {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
  mocks.publicQuery = {
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  };
  mocks.adminQueryCalls.length = 0;
  mocks.publicQueryCalls.length = 0;
});

describe("theme catalog UI", () => {
  it("denies a non-admin while keeping the admin catalog query disabled", () => {
    const html = renderToStaticMarkup(React.createElement(AdminThemes));
    expect(html).toContain("Admin Login Required");
    expect(mocks.adminQueryCalls).toHaveLength(1);
    expect(mocks.adminQueryCalls[0][1]).toEqual({ enabled: false });
  });

  it("renders the private editor and catalog preview only for an authenticated admin", () => {
    mocks.auth = {
      user: { role: "admin" },
      isAuthenticated: true,
      loading: false,
      openSignIn: vi.fn(),
    };
    mocks.adminQuery.data = {
      revision: '"catalog-etag"',
      themes: [adminTheme],
      music,
    };
    const html = renderToStaticMarkup(React.createElement(AdminThemes));
    expect(html).toContain("Theme Manager");
    expect(html).toContain("Story catalog");
    expect(html).toContain("Adventure");
    expect(html).toContain("Hide");
    expect(html).not.toContain("artwork URL");
    expect(mocks.adminQueryCalls[0][1]).toEqual({ enabled: true });
    const source = readFileSync(
      new URL("../client/src/pages/AdminThemes.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("Private story setting");
    expect(source).toMatch(/Family\s+preview/);
  });

  it("uses the public catalog for upload rather than a hard-coded theme list", () => {
    mocks.publicQuery.data = {
      revision: '"catalog-etag"',
      themes: [
        { ...adminTheme, storySetting: undefined, storyTone: undefined },
      ],
      music,
    };
    const html = renderToStaticMarkup(React.createElement(Upload));
    expect(html).toContain("Upload Your Child");
    expect(mocks.publicQueryCalls).toHaveLength(1);
    const source = readFileSync(
      new URL("../client/src/pages/Upload.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("listPublic.useQuery");
    expect(source).toMatch(/storyTheme,\s*musicId,\s*mimeType/);
    expect(source).not.toContain('musicId === "none" ? undefined');
    expect(source).not.toContain("THEME_OPTIONS");
  });

  it("shows no-music, available sample, and unavailable preset states without autoplay", () => {
    const html = renderToStaticMarkup(
      React.createElement(ThemeMusicPicker, {
        music,
        selectedMusicId: "none",
        onChange: vi.fn(),
      })
    );
    expect(html).toContain("No music");
    expect(html).toContain("Play Playful Adventure sample");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("autoplay");
  });
});

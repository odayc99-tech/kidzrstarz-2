import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_VOICE_RETIREMENT_DATE,
  NARRATOR_AUDITION_MODEL,
  NARRATOR_AUDITION_PRESETS,
  NARRATOR_AUDITION_SETTINGS,
  NARRATOR_AUDITION_TEXT,
} from "../shared/narratorAuditions";

const mocks = vi.hoisted(() => ({
  auth: {} as any,
  catalog: undefined as any,
  isLoading: false,
  error: null as any,
  query: vi.fn(),
  refetch: vi.fn(),
  audition: vi.fn(),
  storageCheck: vi.fn(),
  storageResult: undefined as any,
  storageError: null as any,
  buttons: [] as any[],
}));

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    narrators: {
      listAuditions: {
        useQuery: (input: unknown, options: unknown) => {
          mocks.query(input, options);
          return {
            data: mocks.catalog,
            isLoading: mocks.isLoading,
            error: mocks.error,
            refetch: mocks.refetch,
          };
        },
      },
      audition: {
        useMutation: () => ({ mutateAsync: mocks.audition, isPending: false }),
      },
      checkStorage: {
        useMutation: () => ({ mutateAsync: mocks.storageCheck, isPending: false, data: mocks.storageResult, error: mocks.storageError }),
      },
    },
  },
}));
vi.mock("wouter", () => ({
  Link: (props: any) =>
    React.createElement("a", { href: props.href }, props.children),
}));
vi.mock("@/components/ui/button", () => ({
  Button: (props: any) => {
    mocks.buttons.push(props);
    return React.createElement(
      "button",
      {
        disabled: props.disabled,
        "aria-label": props["aria-label"],
      },
      props.children
    );
  },
}));
vi.mock("@/components/ui/card", () => ({
  Card: (props: any) => React.createElement("div", {}, props.children),
  CardContent: (props: any) => React.createElement("div", {}, props.children),
  CardHeader: (props: any) => React.createElement("div", {}, props.children),
  CardTitle: (props: any) => React.createElement("h3", {}, props.children),
}));

import AdminNarrators, { safePreparationError } from "../client/src/pages/AdminNarrators";

const source = readFileSync(
  new URL("../client/src/pages/AdminNarrators.tsx", import.meta.url),
  "utf8"
);
const appSource = readFileSync(
  new URL("../client/src/App.tsx", import.meta.url),
  "utf8"
);
const adminSource = readFileSync(
  new URL("../client/src/pages/Admin.tsx", import.meta.url),
  "utf8"
);
const renderPage = () =>
  renderToStaticMarkup(React.createElement(AdminNarrators));
const generateButtons = () =>
  mocks.buttons.filter(button =>
    /^Generate sample for /.test(button["aria-label"] ?? "")
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("React", React);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Live network forbidden");
    })
  );
  vi.stubGlobal(
    "Audio",
    vi.fn(() => {
      throw new Error("Automatic audio forbidden");
    })
  );
  mocks.auth = {
    user: { id: 7, role: "admin" },
    isAuthenticated: true,
    loading: false,
  };
  mocks.catalog = {
    presets: NARRATOR_AUDITION_PRESETS,
    text: NARRATOR_AUDITION_TEXT,
    modelId: NARRATOR_AUDITION_MODEL,
    settings: NARRATOR_AUDITION_SETTINGS,
    retirementDate: DEFAULT_VOICE_RETIREMENT_DATE,
  };
  mocks.isLoading = false;
  mocks.error = null;
  mocks.buttons = [];
  mocks.storageResult = undefined;
  mocks.storageError = null;
  mocks.storageCheck.mockResolvedValue(undefined);
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(Audio).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe("admin narrator auditions offline UI", () => {
  it.each([
    { user: null, isAuthenticated: false, loading: false },
    { user: { id: 8, role: "user" }, isAuthenticated: true, loading: false },
    { user: { id: 7, role: "admin" }, isAuthenticated: false, loading: false },
  ])(
    "gates the shortlist and query behind an authenticated admin session (%j)",
    auth => {
      mocks.auth = auth;
      const html = renderPage();

      expect(html).toContain("Admin Login Required");
      expect(html).toContain('href="/admin-login"');
      expect(html).not.toContain("Jade");
      expect(html).not.toContain("narrator-confirm-credits");
      expect(mocks.query).toHaveBeenCalledWith(undefined, { enabled: false });
      expect(mocks.audition).not.toHaveBeenCalled();
    }
  );

  it("does not expose or query audition controls while authentication is loading", () => {
    mocks.auth.loading = true;
    const html = renderPage();

    expect(html).toContain("Loading admin session");
    expect(html).not.toContain("Generate sample");
    expect(mocks.query).toHaveBeenCalledWith(undefined, { enabled: false });
    expect(mocks.audition).not.toHaveBeenCalled();
  });

  it("shows exactly three tentative candidates without claiming a child preference, eligibility or default change", () => {
    const html = renderPage();

    expect(mocks.query).toHaveBeenCalledWith(undefined, { enabled: true });
    for (const preset of NARRATOR_AUDITION_PRESETS) {
      expect(html).toContain(preset.name);
      expect(html).toContain(preset.label);
      expect(html).toContain(preset.description);
      expect(html).not.toContain(preset.voiceId);
    }
    expect(html.match(/Tentative candidate/g)).toHaveLength(3);
    expect(html).toContain("A tentative shortlist to listen to");
    expect(html).toContain(
      "not confirmed child preferences or confirmed account/model eligibility"
    );
    expect(html).toContain("Sarah retires on");
    expect(html).toContain("December 31, 2026");
    expect(html).toContain("default narrator is unchanged");
    expect(html).not.toContain("Use as default");
    expect(html).toContain('href="/admin"');
    expect(html).toContain('href="/admin/themes"');
  });

  it("uses the identical fixed fictional script and one native model/settings for the dry comparison", () => {
    const html = renderPage();
    const escapedScript = renderToStaticMarkup(
      React.createElement("span", null, NARRATOR_AUDITION_TEXT)
    ).replace(/^<span>|<\/span>$/g, "");

    expect(html.split(escapedScript)).toHaveLength(2);
    expect(html).toContain("Same passage, same native model");
    expect(html).toContain("identical fictional script");
    expect(html).toContain("no background music");
    expect(html).toContain(NARRATOR_AUDITION_MODEL);
    expect(html).toContain("Stability 0.55");
    expect(html).toContain("Similarity 0.8");
    expect(html).toContain("Style 0");
    expect(html).toContain("Speed 0.95");
    expect(html).toContain("Speaker boost on");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain('type="text"');
  });

  it("requires an unchecked explicit credit checkbox and blocks every generation handler without confirmation", () => {
    const html = renderPage();
    const checkbox = html.match(
      /<input[^>]*id="narrator-confirm-credits"[^>]*>/
    )?.[0];

    expect(checkbox).toBeDefined();
    expect(checkbox).toContain('type="checkbox"');
    expect(checkbox).not.toContain("checked");
    expect(html).toContain(
      "Generating a missing sample uses existing ElevenLabs credits"
    );
    expect(html).toContain("cached sample is returned without new generation");
    expect(html).toContain("replaying a prepared clip does not regenerate it");
    expect(generateButtons()).toHaveLength(3);
    for (const button of generateButtons()) {
      expect(button.disabled).toBe(true);
      // Bypass the disabled DOM control: the handler itself still enforces consent.
      button.onClick();
    }
    expect(mocks.audition).not.toHaveBeenCalled();
  });

  it("does not generate or play during SSR and keeps async preparation separate from the user playback gesture", () => {
    const html = renderPage();
    const generationSource = source.slice(
      source.indexOf("const generateSample ="),
      source.indexOf("const togglePlayback =")
    );
    const effectsSource = source.slice(
      source.indexOf("useEffect(() =>"),
      source.indexOf("const stopPlayback =")
    );

    expect(html).toContain("Nothing generates or plays automatically");
    expect(html).toContain("separate Play button");
    expect(html).toContain("Browsers may block playback");
    expect(html).not.toContain("<audio");
    expect(html).not.toContain('aria-label="Play Jade sample"');
    expect(mocks.audition).not.toHaveBeenCalled();
    expect(generationSource).toContain("!confirmCredits");
    expect(generationSource).toMatch(
      /mutateAsync\(\{\s*presetId,\s*confirmCredits: true,\s*\}\)/
    );
    expect(generationSource).not.toContain(".play(");
    expect(generationSource).not.toContain("new Audio");
    expect(effectsSource).not.toContain("mutateAsync");
    expect(source).not.toContain("autoPlay");
    expect(source).not.toContain("setDefault");
    expect(source).not.toContain("retryOwnNarration");
  });

  it("provides explicit same-cache link refresh and one-at-a-time playback cleanup, not an automatic paid retry", () => {
    const html = renderPage();
    expect(html).toContain("One narrator plays at a time");
    expect(html).toContain("request a fresh link through the same cache");
    expect(html).toContain("No automatic paid retry or default change");
    expect(source).toContain("releaseAudio(audioRef.current)");
    expect(source).toContain('audio.removeAttribute("src")');
    expect(source).toContain("audio.onended = null");
    expect(source).toContain("audio.onerror = null");
    expect(source.match(/auditionMutation\.mutateAsync\(/g)).toHaveLength(1);
  });

  it("shows a safe catalog failure without exposing private provider or signed URL errors", () => {
    mocks.error = new Error(
      "secret provider key; https://private.example.invalid/signed?token=secret"
    );
    mocks.catalog = undefined;
    const html = renderPage();

    expect(html).toContain("Narrator auditions could not load");
    expect(html).not.toContain("secret provider key");
    expect(html).not.toContain("private.example.invalid");
    expect(generateButtons()).toHaveLength(0);
    expect(mocks.audition).not.toHaveBeenCalled();
  });

  it("preserves existing route order, the admin login and the admin dashboard navigation", () => {
    const paths = [...appSource.matchAll(/<Route path=\{\"([^\"]+)\"\}/g)].map(
      match => match[1]
    );
    expect(paths).toEqual([
      "/",
      "/upload",
      "/checkout",
      "/dashboard",
      "/storybook",
      "/my-orders",
      "/share/:token",
      "/admin",
      "/admin/themes",
      "/admin/narrators",
      "/admin-login",
      "/404",
    ]);
    expect(adminSource).toContain('<Link href="/admin/narrators">');
    expect(adminSource).toContain('<Link href="/admin/themes">');
    expect(appSource).toContain(
      '<Route path={"/admin-login"} component={AdminLogin} />'
    );
  });

  it("offers an explicit storage check with no credit checkbox or voice generation required", async () => {
    const html = renderPage();
    expect(html).toContain("Check sample storage");
    expect(html).toContain("It does not generate speech, use voice credits");
    expect(mocks.storageCheck).not.toHaveBeenCalled();
    const button = mocks.buttons.find(button => button["aria-label"] === "Check sample storage");
    expect(button.disabled).toBe(false);
    await button.onClick();
    expect(mocks.storageCheck).toHaveBeenCalledOnce();
    expect(mocks.audition).not.toHaveBeenCalled();
  });

  it("displays safe diagnostic phase and reason, never a raw mutation error", () => {
    mocks.storageResult = { ok: false, stage: "cache-read", reason: "AccessDenied", message: "Storage access was denied.", providerKeyConfigured: true };
    mocks.storageError = new Error("SECRET_RAW_PAYLOAD");
    const html = renderPage();
    expect(html).toContain("Storage check failed");
    expect(html).toContain("cache-read");
    expect(html).toContain("AccessDenied");
    expect(html).toContain("No speech was requested");
    expect(html).not.toContain("SECRET_RAW_PAYLOAD");
  });

  it("preserves allowlisted backend storage errors without exposing arbitrary provider messages", () => {
    expect(safePreparationError({ data: { code: "PRECONDITION_FAILED" }, message: "Private narrator audition storage is unavailable. Please try again later." })).toContain("Check sample storage");
    expect(safePreparationError({ data: { code: "PRECONDITION_FAILED" }, message: "SECRET_KEY?token=secret" })).not.toContain("SECRET_KEY");
    expect(safePreparationError({ data: { code: "INTERNAL_SERVER_ERROR" }, message: "Private narrator audition storage is unavailable. Please try again later." })).not.toContain("Check sample storage");
  });
});

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Anchor,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bone,
  CheckCircle2,
  Crown,
  Fish,
  Gift,
  Loader2,
  Palette,
  PencilLine,
  Plus,
  Rocket,
  Save,
  ShieldAlert,
  Snowflake,
  Sparkles,
  TreePine,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { MusicPreset, ThemeDefinition } from "@shared/experienceCatalog";

type AdminCatalog = {
  revision: string;
  themes: ThemeDefinition[];
  music: MusicPreset[];
};

const ICONS = {
  sparkles: Sparkles,
  crown: Crown,
  rocket: Rocket,
  fish: Fish,
  shield: ShieldAlert,
  bone: Bone,
  anchor: Anchor,
  tree: TreePine,
  snowflake: Snowflake,
  gift: Gift,
  pumpkin: Sparkles,
} as const;

const ICON_IDS = Object.keys(ICONS) as Array<keyof typeof ICONS>;
const COLOR_IDS = [
  "amber",
  "pink",
  "indigo",
  "cyan",
  "red",
  "green",
  "yellow",
  "emerald",
] as const;

const COLOR_STYLES: Record<
  (typeof COLOR_IDS)[number],
  { card: string; tile: string }
> = {
  amber: {
    card: "border-amber-200 bg-amber-50",
    tile: "from-amber-500 to-orange-500",
  },
  pink: {
    card: "border-pink-200 bg-pink-50",
    tile: "from-pink-500 to-rose-500",
  },
  indigo: {
    card: "border-indigo-200 bg-indigo-50",
    tile: "from-indigo-500 to-blue-500",
  },
  cyan: {
    card: "border-cyan-200 bg-cyan-50",
    tile: "from-cyan-500 to-teal-500",
  },
  red: { card: "border-red-200 bg-red-50", tile: "from-red-500 to-rose-500" },
  green: {
    card: "border-green-200 bg-green-50",
    tile: "from-green-500 to-emerald-500",
  },
  yellow: {
    card: "border-yellow-200 bg-yellow-50",
    tile: "from-yellow-500 to-amber-500",
  },
  emerald: {
    card: "border-emerald-200 bg-emerald-50",
    tile: "from-emerald-500 to-green-600",
  },
};

function sortThemes(themes: ThemeDefinition[]) {
  return [...themes].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.title.localeCompare(right.title)
  );
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "new-theme"
  );
}

function cloneTheme(theme: ThemeDefinition): ThemeDefinition {
  return { ...theme };
}

function isConflict(error: unknown) {
  const candidate = error as { data?: { code?: string }; message?: string };
  return (
    candidate?.data?.code === "CONFLICT" ||
    /conflict|revision/i.test(candidate?.message ?? "")
  );
}

export default function AdminThemesPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const isAdmin = isAuthenticated && user?.role === "admin";
  const adminCatalogQuery = trpc.themes.listAdmin.useQuery(undefined, {
    enabled: isAdmin,
  });
  const saveMutation = trpc.themes.save.useMutation();
  const publishMutation = trpc.themes.setPublished.useMutation();
  const reorderMutation = trpc.themes.reorder.useMutation();

  const [draft, setDraft] = useState<ThemeDefinition | null>(null);
  const [originalDraft, setOriginalDraft] = useState<ThemeDefinition | null>(
    null
  );
  const [isNew, setIsNew] = useState(false);
  const [localRevision, setLocalRevision] = useState<string | null>(null);
  const [draftRevision, setDraftRevision] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [conflictCatalog, setConflictCatalog] = useState<AdminCatalog | null>(
    null
  );

  const catalog = adminCatalogQuery.data as AdminCatalog | undefined;
  const orderedThemes = useMemo(
    () => sortThemes(catalog?.themes ?? []),
    [catalog?.themes]
  );
  const revision = localRevision ?? catalog?.revision ?? null;
  const selectedSavedTheme =
    catalog?.themes.find(theme => theme.id === draft?.id) ?? null;
  const draftIsDirty = Boolean(
    draft &&
      (!originalDraft ||
        JSON.stringify(draft) !== JSON.stringify(originalDraft))
  );

  useEffect(() => {
    if (catalog?.revision) setLocalRevision(catalog.revision);
  }, [catalog?.revision]);

  useEffect(() => {
    if (draft || orderedThemes.length === 0) return;
    const first = cloneTheme(orderedThemes[0]);
    setDraft(first);
    setOriginalDraft(cloneTheme(first));
    setDraftRevision(catalog?.revision ?? null);
    setIsNew(false);
  }, [catalog?.revision, draft, orderedThemes]);

  const refreshCatalog = async () => {
    const result = await adminCatalogQuery.refetch();
    const latest = result.data as AdminCatalog | undefined;
    if (latest?.revision) setLocalRevision(latest.revision);
    return latest ?? null;
  };

  const handleConflict = async (error: unknown) => {
    if (!isConflict(error)) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the catalog."
      );
      return;
    }
    let latest: AdminCatalog | null = null;
    try {
      latest = await refreshCatalog();
    } catch {
      // Keep the local draft intact even if the refresh itself is temporarily unavailable.
    }
    setConflictCatalog(latest);
    setFeedback(
      "Someone saved a newer catalog. Your unsaved editor changes are still here; load the latest version only when you are ready to discard them."
    );
  };

  const chooseTheme = (theme: ThemeDefinition) => {
    if (
      draftIsDirty &&
      !window.confirm(
        "Switch themes and discard the unsaved edits in this editor?"
      )
    )
      return;
    const next = cloneTheme(theme);
    setDraft(next);
    setOriginalDraft(cloneTheme(next));
    setDraftRevision(revision);
    setIsNew(false);
    setFeedback(null);
    setConflictCatalog(null);
  };

  const createTheme = () => {
    if (
      draftIsDirty &&
      !window.confirm(
        "Start a new theme and discard the unsaved edits in this editor?"
      )
    )
      return;
    const availableMusic =
      (catalog?.music ?? []).find(preset => preset.available) ??
      catalog?.music?.[0];
    const next: ThemeDefinition = {
      id: "new-theme",
      title: "New Theme",
      description: "A bright new story adventure.",
      category: "adventure",
      icon: "sparkles" as ThemeDefinition["icon"],
      color: "amber" as ThemeDefinition["color"],
      storySetting: "",
      storyTone: "",
      defaultMusicId: availableMusic?.id ?? null,
      featured: false,
      sortOrder: orderedThemes.length,
      published: false,
    };
    setDraft(next);
    setOriginalDraft(null);
    setDraftRevision(revision);
    setIsNew(true);
    setFeedback(
      "New theme draft. Its stable ID can be adjusted until the first save."
    );
    setConflictCatalog(null);
  };

  const useLatestCatalog = () => {
    const latest = conflictCatalog ?? catalog;
    if (!latest) return;
    const replacement =
      latest.themes.find(theme => theme.id === draft?.id) ?? latest.themes[0];
    if (replacement) {
      const next = cloneTheme(replacement);
      setDraft(next);
      setOriginalDraft(cloneTheme(next));
      setIsNew(false);
    } else {
      setDraft(null);
      setOriginalDraft(null);
    }
    setDraftRevision(latest.revision);
    setFeedback("Editor reloaded from the latest saved catalog.");
    setConflictCatalog(null);
  };

  const saveDraft = async () => {
    if (!draft || !draftRevision) return;
    if (
      !draft.id.trim() ||
      !draft.title.trim() ||
      !draft.description.trim() ||
      !draft.category.trim()
    ) {
      toast.error("Add an ID, title, description, and category before saving.");
      return;
    }
    try {
      const response = await saveMutation.mutateAsync({
        expectedRevision: draftRevision,
        theme: draft,
      });
      setLocalRevision(response.revision);
      setDraftRevision(response.revision);
      const saved =
        response.themes.find(theme => theme.id === draft.id) ?? draft;
      setDraft(cloneTheme(saved));
      setOriginalDraft(cloneTheme(saved));
      setIsNew(false);
      setFeedback(
        "Theme saved. Published changes are now reflected in the catalog."
      );
      setConflictCatalog(null);
      void adminCatalogQuery.refetch();
      toast.success("Theme saved");
    } catch (error) {
      await handleConflict(error);
    }
  };

  const setPublished = async (theme: ThemeDefinition, published: boolean) => {
    if (!revision) return;
    try {
      const response = await publishMutation.mutateAsync({
        expectedRevision: revision,
        id: theme.id,
        published,
      });
      setLocalRevision(response.revision);
      void adminCatalogQuery.refetch();
      setFeedback(
        published
          ? `${theme.title} is published.`
          : `${theme.title} is hidden from new uploads.`
      );
      toast.success(published ? "Theme published" : "Theme hidden");
    } catch (error) {
      await handleConflict(error);
    }
  };

  const moveTheme = async (index: number, direction: -1 | 1) => {
    if (!revision) return;
    const destination = index + direction;
    if (destination < 0 || destination >= orderedThemes.length) return;
    const reordered = [...orderedThemes];
    [reordered[index], reordered[destination]] = [
      reordered[destination],
      reordered[index],
    ];
    try {
      // The server receives the complete ordered list, never a partial move.
      const response = await reorderMutation.mutateAsync({
        expectedRevision: revision,
        ids: reordered.map(theme => theme.id),
      });
      setLocalRevision(response.revision);
      void adminCatalogQuery.refetch();
      setFeedback("Theme order saved.");
    } catch (error) {
      await handleConflict(error);
    }
  };

  const iconFor = (icon: ThemeDefinition["icon"]) =>
    ICONS[icon as keyof typeof ICONS] ?? Sparkles;
  const styleFor = (color: ThemeDefinition["color"]) =>
    COLOR_STYLES[color as keyof typeof COLOR_STYLES] ?? COLOR_STYLES.amber;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-8 text-center">
            <ShieldAlert className="w-12 h-12 text-purple-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Admin Login Required
            </h1>
            <p className="text-slate-600 mb-6">
              Please sign in with your admin secret to manage story themes.
            </p>
            <Link href="/admin-login">
              <Button className="w-full mb-3">Sign In as Admin</Button>
            </Link>
            <Link href="/">
              <Button variant="outline">Go Home</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (adminCatalogQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  if (adminCatalogQuery.error || !catalog) {
    return (
      <div className="min-h-screen bg-slate-50">
        <AdminThemesHeader />
        <main className="container max-w-3xl py-10">
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6 text-center">
              <TriangleAlert className="w-10 h-10 text-amber-600 mx-auto mb-3" />
              <h2 className="text-lg font-bold text-slate-900">
                Themes could not load
              </h2>
              <p className="text-sm text-slate-600 mt-2 mb-4">
                {adminCatalogQuery.error?.message ??
                  "Please try loading the catalog again."}
              </p>
              <Button onClick={() => void refreshCatalog()} variant="outline">
                Try Again
              </Button>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-amber-50">
      <AdminThemesHeader />
      <main className="container max-w-7xl py-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <p className="text-sm font-semibold text-purple-700">
              Story catalog
            </p>
            <h2 className="text-3xl font-bold text-slate-900">
              Themes & music
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Only published themes appear to families. Story setting and tone
              stay private.
            </p>
          </div>
          <Button
            onClick={createTheme}
            className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
          >
            <Plus className="w-4 h-4 mr-2" /> New Theme
          </Button>
        </div>

        {feedback && (
          <div
            role="status"
            className={`mb-5 rounded-xl border p-4 text-sm ${conflictCatalog ? "border-amber-300 bg-amber-50 text-amber-900" : "border-purple-200 bg-white/80 text-slate-700"}`}
          >
            <div className="flex items-start justify-between gap-3">
              <span>{feedback}</span>
              {conflictCatalog && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-amber-300"
                  onClick={useLatestCatalog}
                >
                  Load latest & discard my draft
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-6">
          <Card className="h-fit">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Catalog order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderedThemes.map((theme, index) => {
                const Icon = iconFor(theme.icon);
                const styles = styleFor(theme.color);
                const active = !isNew && draft?.id === theme.id;
                return (
                  <div
                    key={theme.id}
                    className={`rounded-xl border-2 p-3 ${active ? "border-purple-400 bg-purple-50" : styles.card}`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        onClick={() => chooseTheme(theme)}
                      >
                        <span
                          className={`w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br ${styles.tile} flex items-center justify-center`}
                        >
                          <Icon className="w-4 h-4 text-white" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-slate-800">
                            {theme.title}
                          </span>
                          <span className="block text-xs text-slate-500">
                            {theme.published ? "Published" : "Hidden"}
                            {theme.featured ? " · Featured" : ""}
                          </span>
                        </span>
                      </button>
                      <div className="flex items-center gap-1">
                        <Button
                          aria-label={`Move ${theme.title} up`}
                          variant="ghost"
                          size="icon"
                          disabled={index === 0 || reorderMutation.isPending}
                          onClick={() => void moveTheme(index, -1)}
                        >
                          <ArrowUp className="w-4 h-4" />
                        </Button>
                        <Button
                          aria-label={`Move ${theme.title} down`}
                          variant="ghost"
                          size="icon"
                          disabled={
                            index === orderedThemes.length - 1 ||
                            reorderMutation.isPending
                          }
                          onClick={() => void moveTheme(index, 1)}
                        >
                          <ArrowDown className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-500">
                        ID: {theme.id}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className={
                          theme.published
                            ? "border-amber-300 text-amber-700"
                            : "border-green-300 text-green-700"
                        }
                        disabled={publishMutation.isPending}
                        onClick={() =>
                          void setPublished(theme, !theme.published)
                        }
                      >
                        {theme.published ? "Hide" : "Publish"}
                      </Button>
                    </div>
                  </div>
                );
              })}
              {orderedThemes.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
                  No themes are in this catalog yet. Create the first one.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            {draft ? (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2">
                    <PencilLine className="w-5 h-5 text-purple-600" />{" "}
                    {isNew ? "New theme" : "Edit theme"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="theme-id">Stable ID</Label>
                      <Input
                        id="theme-id"
                        className="mt-1"
                        value={draft.id}
                        disabled={!isNew}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            id: slugify(event.target.value),
                          })
                        }
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        {isNew
                          ? "A lowercase slug; it becomes immutable after saving."
                          : "Stable IDs cannot be changed after saving."}
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="theme-category">Category</Label>
                      <Input
                        id="theme-category"
                        className="mt-1"
                        value={draft.category}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            category: slugify(event.target.value),
                          })
                        }
                        maxLength={32}
                      />
                      <p className="mt-1 text-xs text-slate-500">
                        Lowercase category slug, for example: adventure.
                      </p>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="theme-title">Title</Label>
                    <Input
                      id="theme-title"
                      className="mt-1"
                      value={draft.title}
                      onChange={event =>
                        setDraft({
                          ...draft,
                          title: event.target.value,
                          id: isNew ? slugify(event.target.value) : draft.id,
                        })
                      }
                      maxLength={100}
                    />
                  </div>
                  <div>
                    <Label htmlFor="theme-description">Short description</Label>
                    <Textarea
                      id="theme-description"
                      className="mt-1 min-h-[76px]"
                      value={draft.description}
                      onChange={event =>
                        setDraft({ ...draft, description: event.target.value })
                      }
                      maxLength={300}
                    />
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="theme-icon">Built-in icon</Label>
                      <select
                        id="theme-icon"
                        value={draft.icon}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            icon: event.target.value as ThemeDefinition["icon"],
                          })
                        }
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {ICON_IDS.map(icon => (
                          <option key={icon} value={icon}>
                            {icon}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="theme-color">Color</Label>
                      <select
                        id="theme-color"
                        value={draft.color}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            color: event.target
                              .value as ThemeDefinition["color"],
                          })
                        }
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {COLOR_IDS.map(color => (
                          <option key={color} value={color}>
                            {color}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="default-music">Default music</Label>
                      <select
                        id="default-music"
                        value={draft.defaultMusicId ?? ""}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            defaultMusicId: (event.target.value ||
                              null) as ThemeDefinition["defaultMusicId"],
                          })
                        }
                        className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="">No music</option>
                        {catalog.music.map(preset => (
                          <option
                            key={preset.id}
                            value={preset.id}
                            disabled={!preset.available}
                          >
                            {preset.label}
                            {preset.available ? "" : " (unavailable)"}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label htmlFor="sort-order">Sort order</Label>
                      <Input
                        id="sort-order"
                        type="number"
                        className="mt-1"
                        value={draft.sortOrder}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            sortOrder: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="rounded-xl border border-purple-100 bg-purple-50/70 p-4 space-y-4">
                    <div>
                      <Label
                        htmlFor="story-setting"
                        className="text-purple-900"
                      >
                        Private story setting
                      </Label>
                      <Textarea
                        id="story-setting"
                        value={draft.storySetting}
                        onChange={event =>
                          setDraft({
                            ...draft,
                            storySetting: event.target.value,
                          })
                        }
                        className="mt-1 min-h-[82px] bg-white"
                        maxLength={2_000}
                      />
                      <p className="mt-1 text-xs text-purple-700">
                        Only used to guide story generation; never shown to
                        families.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="story-tone" className="text-purple-900">
                        Private story tone
                      </Label>
                      <Textarea
                        id="story-tone"
                        value={draft.storyTone}
                        onChange={event =>
                          setDraft({ ...draft, storyTone: event.target.value })
                        }
                        className="mt-1 min-h-[70px] bg-white"
                        maxLength={1_000}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Switch
                        checked={draft.featured}
                        onCheckedChange={checked =>
                          setDraft({ ...draft, featured: checked })
                        }
                      />{" "}
                      Featured
                    </label>
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                      <Switch
                        checked={draft.published}
                        onCheckedChange={checked =>
                          setDraft({ ...draft, published: checked })
                        }
                      />{" "}
                      Published
                    </label>
                  </div>
                  <div className="flex justify-end gap-3 pt-1">
                    <Button
                      variant="outline"
                      onClick={() =>
                        selectedSavedTheme && chooseTheme(selectedSavedTheme)
                      }
                      disabled={!draftIsDirty || !selectedSavedTheme}
                    >
                      Discard edits
                    </Button>
                    <Button
                      onClick={() => void saveDraft()}
                      disabled={
                        !draftIsDirty ||
                        saveMutation.isPending ||
                        Boolean(conflictCatalog)
                      }
                      className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    >
                      {saveMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}{" "}
                      Save theme
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-slate-600">
                  Choose a theme or create a new one to begin.
                </CardContent>
              </Card>
            )}

            {draft &&
              (() => {
                const Icon = iconFor(draft.icon);
                const styles = styleFor(draft.color);
                const music = catalog.music.find(
                  preset => preset.id === draft.defaultMusicId
                );
                return (
                  <Card className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2">
                        <Palette className="w-5 h-5 text-purple-600" /> Family
                        preview
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div
                        className={`rounded-2xl border-2 p-5 ${styles.card}`}
                      >
                        <div
                          className={`w-12 h-12 rounded-xl bg-gradient-to-br ${styles.tile} flex items-center justify-center mb-4`}
                        >
                          <Icon className="w-6 h-6 text-white" />
                        </div>
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          {draft.category}
                        </p>
                        <h3 className="text-xl font-bold text-slate-900 mt-1">
                          {draft.title}
                        </h3>
                        <p className="text-sm text-slate-600 mt-2">
                          {draft.description}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
                            {draft.published
                              ? "Published"
                              : "Hidden until published"}
                          </span>
                          {draft.featured && (
                            <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
                              Featured
                            </span>
                          )}
                          <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700">
                            {music?.label ?? "No default music"}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
          </div>
        </div>
      </main>
    </div>
  );
}

function AdminThemesHeader() {
  return (
    <header className="bg-white/90 backdrop-blur-md border-b border-purple-100 shadow-sm">
      <div className="container flex items-center justify-between h-16 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Orders
            </Button>
          </Link>
          <h1 className="truncate text-xl font-bold text-slate-900 flex items-center gap-2">
            <Palette className="w-5 h-5 text-purple-600" /> Theme Manager
          </h1>
        </div>
        <Link href="/dashboard">
          <Button variant="outline" size="sm">
            Dashboard
          </Button>
        </Link>
      </div>
    </header>
  );
}

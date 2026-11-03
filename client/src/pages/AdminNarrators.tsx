import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  Headphones,
  Loader2,
  Pause,
  Play,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_VOICE_RETIREMENT_DATE,
  NARRATOR_AUDITION_PRESETS,
  type NarratorAuditionId,
  type NarratorAuditionResult,
} from "@shared/narratorAuditions";

type AuditionCatalog = {
  presets: ReadonlyArray<{
    id: NarratorAuditionId;
    name: string;
    label: string;
    description: string;
  }>;
  text: string;
  modelId: string;
  settings: {
    stability: number;
    similarity_boost: number;
    style: number;
    speed: number;
    use_speaker_boost: boolean;
  };
  retirementDate: string;
};

function releaseAudio(audio: HTMLAudioElement | null) {
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
}

export function safePreparationError(error: unknown) {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") {
    return "Your admin session could not be verified. Sign in again before preparing a sample.";
  }
  if (code === "CONFLICT" || code === "TOO_MANY_REQUESTS") {
    return "A sample may already be preparing. Wait a moment, then explicitly try again.";
  }
  const message = (error as { message?: unknown } | null)?.message;
  const safeMessages = [
    "Private narrator audition storage is unavailable. Please try again later.",
    "The narrator audition audio could not be validated. No substitute audio was used.",
    "This native narrator audition is unavailable. No substitute voice or model was used.",
  ];
  if (code === "PRECONDITION_FAILED" && typeof message === "string" && safeMessages.includes(message)) {
    return message === safeMessages[0]
      ? `${message} Use Check sample storage; it does not use voice credits.`
      : message;
  }
  // Never expose provider responses, private storage details, or signed URLs.
  return "The sample could not be prepared. Check provider availability and try again when ready. No replacement voice or model was used.";
}

export default function AdminNarratorsPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const isAdmin = isAuthenticated && user?.role === "admin";
  const auditionsQuery = trpc.narrators.listAuditions.useQuery(undefined, {
    enabled: isAdmin && !authLoading,
  });
  const auditionMutation = trpc.narrators.audition.useMutation();
  const storageCheckMutation = trpc.narrators.checkStorage.useMutation();
  const catalog = auditionsQuery.data as AuditionCatalog | undefined;

  const [confirmCredits, setConfirmCredits] = useState(false);
  const [clips, setClips] = useState<
    Partial<Record<NarratorAuditionId, NarratorAuditionResult>>
  >({});
  const [errors, setErrors] = useState<
    Partial<Record<NarratorAuditionId, string>>
  >({});
  const [pendingId, setPendingId] = useState<NarratorAuditionId | null>(null);
  const [playingId, setPlayingId] = useState<NarratorAuditionId | null>(null);
  const pendingRef = useRef<NarratorAuditionId | null>(null);
  const storagePendingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioPresetRef = useRef<NarratorAuditionId | null>(null);
  const playbackVersion = useRef(0);
  const sessionVersion = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sessionVersion.current += 1;
      playbackVersion.current += 1;
      pendingRef.current = null;
      releaseAudio(audioRef.current);
      audioRef.current = null;
      audioPresetRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isAdmin && !authLoading) return;
    // Discard private clip links and invalidate late promises when access changes.
    sessionVersion.current += 1;
    playbackVersion.current += 1;
    pendingRef.current = null;
    releaseAudio(audioRef.current);
    audioRef.current = null;
    audioPresetRef.current = null;
    setConfirmCredits(false);
    setClips({});
    setErrors({});
    setPendingId(null);
    setPlayingId(null);
  }, [isAdmin, authLoading]);

  const stopPlayback = () => {
    playbackVersion.current += 1;
    releaseAudio(audioRef.current);
    audioRef.current = null;
    audioPresetRef.current = null;
    setPlayingId(null);
  };

  const checkStorage = async () => {
    if (!isAdmin || authLoading || pendingRef.current || storagePendingRef.current) return;
    storagePendingRef.current = true;
    stopPlayback();
    try {
      // Only a fixed diagnostic lock is checked; no speech, voice-specific lock or customer object is written.
      await storageCheckMutation.mutateAsync();
    } catch {
      // Display a fixed safe message below, never the raw transport error.
    } finally {
      storagePendingRef.current = false;
    }
  };

  const generateSample = async (presetId: NarratorAuditionId) => {
    if (
      !isAdmin ||
      authLoading ||
      !confirmCredits ||
      !catalog ||
      pendingRef.current ||
      storagePendingRef.current ||
      !NARRATOR_AUDITION_PRESETS.some(preset => preset.id === presetId)
    )
      return;

    const session = sessionVersion.current;
    pendingRef.current = presetId;
    setPendingId(presetId);
    setErrors(previous => ({ ...previous, [presetId]: undefined }));
    stopPlayback();
    // The only paid-capable action is this explicit, credit-confirmed click.
    // The server selects the fixed passage, model, settings and voice ID.
    try {
      const clip = await auditionMutation.mutateAsync({
        presetId,
        confirmCredits: true,
      });
      if (!mounted.current || session !== sessionVersion.current) return;
      setClips(previous => ({ ...previous, [presetId]: clip }));
      // Do not play here: an asynchronous response is not a playback gesture.
    } catch (error) {
      if (!mounted.current || session !== sessionVersion.current) return;
      setErrors(previous => ({
        ...previous,
        [presetId]: safePreparationError(error),
      }));
    } finally {
      if (mounted.current && session === sessionVersion.current) {
        pendingRef.current = null;
        setPendingId(null);
      }
    }
  };

  const togglePlayback = (presetId: NarratorAuditionId) => {
    const clip = clips[presetId];
    if (!isAdmin || authLoading || !clip || pendingRef.current) return;
    if (playingId === presetId && audioRef.current) {
      playbackVersion.current += 1;
      audioRef.current.pause();
      setPlayingId(null);
      return;
    }

    if (audioPresetRef.current !== presetId || !audioRef.current) {
      stopPlayback();
      // Construct and play audio only inside this separate user-click handler.
      const audio = new Audio(clip.url);
      audio.preload = "none";
      audioRef.current = audio;
      audioPresetRef.current = presetId;
      audio.onended = () => {
        if (audioRef.current !== audio) return;
        playbackVersion.current += 1;
        setPlayingId(null);
      };
      audio.onerror = () => {
        if (audioRef.current !== audio) return;
        stopPlayback();
        setClips(previous => ({ ...previous, [presetId]: undefined }));
        setErrors(previous => ({
          ...previous,
          [presetId]:
            "This clip could not play, or its temporary link may have expired. Click Generate sample to request a fresh link from the same cache, then click Play. Cached clips are not regenerated.",
        }));
      };
    }

    const audio = audioRef.current;
    if (!audio) return;
    const attempt = ++playbackVersion.current;
    if (audio.ended) audio.currentTime = 0;
    setErrors(previous => ({ ...previous, [presetId]: undefined }));
    setPlayingId(presetId);
    void audio.play().catch(error => {
      if (!mounted.current || attempt !== playbackVersion.current) return;
      setPlayingId(null);
      if (error instanceof Error && error.name === "NotAllowedError") {
        setErrors(previous => ({
          ...previous,
          [presetId]:
            "Playback was blocked by your browser. Click Play again to start the prepared sample.",
        }));
      } else {
        // A broken/expired URL is refreshed through the same audition endpoint
        // only after another explicit credit-confirmed Generate sample click.
        audio.onerror?.(new Event("error"));
      }
    });
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2
          className="w-8 h-8 animate-spin text-purple-600"
          aria-label="Loading admin session"
        />
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
              Please sign in with your admin secret to audition narrators.
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-pink-50 to-amber-50">
      <AdminNarratorsHeader />
      <main className="container max-w-6xl py-6 space-y-6">
        <div>
          <p className="text-sm font-semibold text-purple-700">
            Admin-only listening lab
          </p>
          <h2 className="text-3xl font-bold text-slate-900">
            Narrator auditions
          </h2>
          <p className="text-sm text-slate-600 mt-2 max-w-3xl">
            A tentative shortlist to listen to—not confirmed child preferences
            or confirmed account/model eligibility. Auditioning does not change
            the default narrator, customer stories, or Use My Voice.
          </p>
        </div>

        <div
          role="note"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex items-start gap-3"
        >
          <TriangleAlert className="w-5 h-5 shrink-0 mt-0.5" />
          <p>
            Sarah retires on{" "}
            <strong>
              {catalog?.retirementDate ?? DEFAULT_VOICE_RETIREMENT_DATE}
            </strong>
            . This is a warning only; the site's default narrator is unchanged.
            Listen and choose before any future integration.
          </p>
        </div>

        {auditionsQuery.isLoading ? (
          <div
            role="status"
            className="flex items-center justify-center py-12 gap-2 text-purple-700"
          >
            <Loader2 className="w-6 h-6 animate-spin" /> Loading the fixed
            audition recipe…
          </div>
        ) : auditionsQuery.error || !catalog ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-6 text-center">
              <h3 className="font-bold text-slate-900">
                Narrator auditions could not load
              </h3>
              <p className="text-sm text-slate-600 mt-2 mb-4">
                Check your admin session and try loading the shortlist again.
                Loading the shortlist does not generate samples.
              </p>
              <Button
                variant="outline"
                onClick={() => void auditionsQuery.refetch()}
              >
                Try Again
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" /> Same passage,
                  same native model
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">
                  Every candidate reads this identical fictional script, with no
                  background music, for a dry comparison.
                </p>
                <blockquote className="rounded-xl border border-purple-100 bg-purple-50/70 p-4 text-slate-800 leading-relaxed">
                  {catalog.text}
                </blockquote>
                <p className="text-xs text-slate-600">
                  Native ElevenLabs Multilingual v2 ·{" "}
                  <code>{catalog.modelId}</code> · Stability{" "}
                  {catalog.settings.stability} · Similarity{" "}
                  {catalog.settings.similarity_boost} · Style{" "}
                  {catalog.settings.style} · Speed {catalog.settings.speed} ·
                  Speaker boost{" "}
                  {catalog.settings.use_speaker_boost ? "on" : "off"}
                </p>
              </CardContent>
            </Card>

            <Card className="border-purple-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Sample storage check</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-slate-600">
                  If samples fail, check storage first. This reads the sample cache and tests a tiny separate temporary lock.
                  It does not generate speech, use voice credits, change permissions, or alter customer stories.
                </p>
                <Button variant="outline" disabled={Boolean(pendingId) || storageCheckMutation.isPending}
                  onClick={() => void checkStorage()} aria-label="Check sample storage">
                  {storageCheckMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  {storageCheckMutation.isPending ? "Checking storage…" : "Check sample storage"}
                </Button>
                {storageCheckMutation.data && (
                  <div role="status" className="rounded-xl border border-purple-100 bg-purple-50 p-3 text-sm text-slate-700 space-y-1">
                    <p className="font-semibold">{storageCheckMutation.data.ok ? "Storage check passed" : "Storage check failed"}</p>
                    <p>{storageCheckMutation.data.message}</p>
                    <p>Step: <code>{storageCheckMutation.data.stage}</code> · Result: <code>{storageCheckMutation.data.reason}</code></p>
                    <p>Voice API key configured: {storageCheckMutation.data.providerKeyConfigured ? "yes" : "no"}.</p>
                    <p className="text-xs">No speech was requested. You can share this result without sharing keys.</p>
                  </div>
                )}
                {storageCheckMutation.error && (
                  <p role="alert" className="text-sm text-amber-900">The storage check could not finish. Refresh your admin session and try the storage check again. No speech was requested.</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-purple-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">
                  Confirm before preparing samples
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p
                  id="narrator-credit-details"
                  className="text-sm text-slate-600"
                >
                  Generating a missing sample uses existing ElevenLabs credits.
                  A cached sample is returned without new generation; replaying
                  a prepared clip does not regenerate it. This does not add
                  voices to the account or upgrade a plan.
                </p>
                <label
                  className="flex items-start gap-3 rounded-xl bg-purple-50 p-4 text-sm font-medium text-purple-900"
                  htmlFor="narrator-confirm-credits"
                >
                  <input
                    id="narrator-confirm-credits"
                    type="checkbox"
                    checked={confirmCredits}
                    onChange={event => setConfirmCredits(event.target.checked)}
                    aria-describedby="narrator-credit-details"
                    className="mt-0.5 h-4 w-4 accent-purple-600"
                  />
                  I confirm use of existing ElevenLabs credits if a selected
                  sample is missing from the cache.
                </label>
                <p className="text-xs text-slate-600">
                  Nothing generates or plays automatically. Choose Generate
                  sample for one voice, wait for it to be ready, then click its
                  separate Play button. Browsers may block playback without that
                  new click.
                </p>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-3 gap-5">
              {NARRATOR_AUDITION_PRESETS.map(candidate => {
                const preset = catalog.presets.find(
                  item => item.id === candidate.id
                );
                if (!preset) return null;
                const clip = clips[preset.id];
                const isPlaying = playingId === preset.id;
                return (
                  <Card
                    key={preset.id}
                    className="border-purple-100 rounded-2xl"
                  >
                    <CardHeader className="pb-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-purple-600">
                        Tentative candidate
                      </p>
                      <CardTitle className="text-2xl">{preset.name}</CardTitle>
                      <p className="text-sm font-semibold text-slate-700">
                        {preset.label}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-slate-600 min-h-[60px]">
                        {preset.description}
                      </p>
                      <Button
                        className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                        disabled={
                          !confirmCredits ||
                          Boolean(pendingId) ||
                          storageCheckMutation.isPending ||
                          auditionMutation.isPending
                        }
                        onClick={() => void generateSample(preset.id)}
                        aria-label={`Generate sample for ${preset.name}`}
                      >
                        {pendingId === preset.id ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Headphones className="w-4 h-4 mr-2" />
                        )}
                        {pendingId === preset.id
                          ? "Preparing sample…"
                          : "Generate sample"}
                      </Button>
                      {clip && (
                        <div className="rounded-xl border border-purple-100 bg-purple-50/70 p-3 space-y-3">
                          <p role="status" className="text-xs text-slate-600">
                            {clip.fromCache
                              ? "Cached sample ready; no new generation."
                              : "New sample ready."}{" "}
                            Click Play to listen.
                          </p>
                          <Button
                            variant="outline"
                            className="w-full border-purple-200 text-purple-700"
                            disabled={Boolean(pendingId)}
                            onClick={() => togglePlayback(preset.id)}
                            aria-label={`${isPlaying ? "Pause" : "Play"} ${preset.name} sample`}
                          >
                            {isPlaying ? (
                              <Pause className="w-4 h-4 mr-2" />
                            ) : (
                              <Play className="w-4 h-4 mr-2" />
                            )}
                            {isPlaying ? "Pause" : "Play"}
                          </Button>
                        </div>
                      )}
                      {errors[preset.id] && (
                        <p
                          role="alert"
                          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
                        >
                          {errors[preset.id]}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              One narrator plays at a time. If a temporary clip link expires,
              click Generate sample again to request a fresh link through the
              same cache, then click Play. No automatic paid retry or default
              change.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function AdminNarratorsHeader() {
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
            <Headphones className="w-5 h-5 text-purple-600" /> Narrator Lab
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/themes">
            <Button variant="outline" size="sm">
              Themes
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="outline" size="sm">
              Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}

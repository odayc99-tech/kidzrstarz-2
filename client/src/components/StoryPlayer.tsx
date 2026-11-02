import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Loader2,
  Film,
  Music,
  Music2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { THEME_BGM } from "@/data/themeBgm";
import type { MusicSelection } from "@shared/experienceCatalog";

export type { MusicSelection } from "@shared/experienceCatalog";

const DEFAULT_MUSIC_VOLUME = 0.12;
const MIN_MUSIC_VOLUME = 0;
const MAX_MUSIC_VOLUME = 0.35;
const NARRATION_DUCK_MULTIPLIER = 0.35;

export interface Scene {
  id: number;
  sceneIndex: number;
  sceneText: string;
  illustrationUrl: string | null;
  narrationUrl: string | null;
  status: string;
}

interface StoryPlayerProps {
  scenes: Scene[];
  childName: string;
  isLoading?: boolean;
  storyTheme?: string;
  /** Undefined is a pre-sidecar order; null is an explicit no-music choice. */
  musicSelection?: MusicSelection | null;
  /** Safe order-response message for a sidecar or music authorization failure. */
  musicError?: string | null;
}

type MusicStatus = "idle" | "loading" | "ready" | "unavailable" | "none";

type MusicSource = {
  key: string;
  url: string;
  label: string;
  defaultVolume: number;
  legacy: boolean;
};

function clampMusicVolume(value: number): number {
  return Math.min(MAX_MUSIC_VOLUME, Math.max(MIN_MUSIC_VOLUME, value));
}

function musicSourceFor(
  musicSelection: MusicSelection | null | undefined,
  storyTheme: string | undefined
): MusicSource | null {
  if (musicSelection === null) return null;

  if (musicSelection) {
    return {
      key: `saved:${musicSelection.id}:${musicSelection.assetPath}:${musicSelection.volume}`,
      // This value is server-selected from the saved snapshot, never a browser
      // upload field. It is a same-origin fixed asset path in normal operation.
      url: musicSelection.assetPath,
      label: musicSelection.label,
      defaultVolume: clampMusicVolume(musicSelection.volume),
      legacy: false,
    };
  }

  const legacy = storyTheme ? THEME_BGM[storyTheme] : null;
  if (!legacy) return null;
  return {
    key: `legacy:${storyTheme}:${legacy.url}`,
    url: legacy.url,
    label: legacy.label,
    defaultVolume: DEFAULT_MUSIC_VOLUME,
    legacy: true,
  };
}

/** Use browser-native speech synthesis only when a narration URL is unavailable. */
function useBrowserTTS() {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = useCallback((text: string, onEnd: () => void) => {
    if (!("speechSynthesis" in window)) {
      setTimeout(onEnd, Math.max(3000, text.length * 60));
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    utterance.pitch = 1.1;
    utterance.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      voice =>
        voice.lang.startsWith("en") &&
        (voice.name.toLowerCase().includes("samantha") ||
          voice.name.toLowerCase().includes("karen") ||
          voice.name.toLowerCase().includes("female") ||
          voice.name.toLowerCase().includes("zira"))
    );
    if (preferred) utterance.voice = preferred;

    utterance.onend = onEnd;
    utterance.onerror = onEnd;
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    if (utteranceRef.current) utteranceRef.current.volume = muted ? 0 : 1;
  }, []);

  return useMemo(() => ({ speak, stop, setMuted }), [speak, stop, setMuted]);
}

/**
 * Lazily creates a single audio element only after the viewer presses Play.
 * The hook owns listener disposal and fades to a ducked level while narration
 * is active, so signed narration URL refreshes never leave an old music element
 * playing in the background.
 */
function useBackgroundMusic(
  source: MusicSource | null,
  musicError: string | null | undefined,
  shouldPlayStory: boolean,
  isNarrating: boolean
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceKeyRef = useRef<string | null>(null);
  const listenerCleanupRef = useRef<(() => void) | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldPlayRef = useRef(false);
  const enabledRef = useRef(true);
  const volumeRef = useRef(DEFAULT_MUSIC_VOLUME);
  const narratingRef = useRef(false);
  const [volume, setVolumeState] = useState(
    source?.defaultVolume ?? DEFAULT_MUSIC_VOLUME
  );
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<MusicStatus>(() => {
    if (musicError) return "unavailable";
    return source ? "idle" : "none";
  });

  shouldPlayRef.current = shouldPlayStory;
  enabledRef.current = enabled;
  volumeRef.current = volume;
  narratingRef.current = isNarrating;

  const clearFade = useCallback(() => {
    if (fadeTimerRef.current) clearInterval(fadeTimerRef.current);
    fadeTimerRef.current = null;
  }, []);

  const fadeToCurrentTarget = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    clearFade();
    const target = enabledRef.current
      ? volumeRef.current *
        (narratingRef.current ? NARRATION_DUCK_MULTIPLIER : 1)
      : 0;
    const direction = target >= audio.volume ? 1 : -1;
    const step = 0.02;
    fadeTimerRef.current = setInterval(() => {
      const current = audioRef.current;
      if (!current) {
        clearFade();
        return;
      }
      const next = current.volume + direction * step;
      if (
        (direction > 0 && next >= target) ||
        (direction < 0 && next <= target)
      ) {
        current.volume = target;
        clearFade();
      } else {
        current.volume = clampMusicVolume(next);
      }
    }, 40);
  }, [clearFade]);

  const disposeAudio = useCallback(() => {
    clearFade();
    listenerCleanupRef.current?.();
    listenerCleanupRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
      audio.load();
    }
    audioRef.current = null;
    sourceKeyRef.current = null;
  }, [clearFade]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch {
      // A just-created media element can reject a seek; it is already paused.
    }
  }, []);

  // A track change or safe access error owns a full cleanup of its old element.
  useEffect(() => {
    disposeAudio();
    if (musicError) {
      setEnabled(false);
      setStatus("unavailable");
      return;
    }
    setStatus(source ? "idle" : "none");
    if (source) setVolumeState(source.defaultVolume);
  }, [disposeAudio, musicError, source?.key]);

  useEffect(() => () => disposeAudio(), [disposeAudio]);

  // No Audio object, fetch, or playback is started on page load. This branch is
  // entered only after a viewer action changes shouldPlayStory to true.
  useEffect(() => {
    if (!source || musicError || !enabled || !shouldPlayStory) {
      pause();
      return;
    }

    const existing = audioRef.current;
    if (existing && sourceKeyRef.current === source.key) {
      fadeToCurrentTarget();
      existing.play().then(() => {
        if (audioRef.current === existing) setStatus("ready");
      }).catch(() => {
        setEnabled(false);
        setStatus("unavailable");
      });
      return;
    }

    disposeAudio();
    const audio = new Audio(source.url);
    audio.loop = true;
    audio.preload = "metadata";
    audio.volume = 0;
    audioRef.current = audio;
    sourceKeyRef.current = source.key;
    setStatus("loading");

    let disposed = false;
    const startWhenReady = () => {
      if (disposed || audioRef.current !== audio) return;
      setStatus("ready");
      fadeToCurrentTarget();
      if (shouldPlayRef.current && enabledRef.current) {
        audio.play().catch(() => {
          if (!disposed) {
            setEnabled(false);
            setStatus("unavailable");
          }
        });
      }
    };
    const unavailable = () => {
      if (disposed || audioRef.current !== audio) return;
      audio.pause();
      setEnabled(false);
      setStatus("unavailable");
    };
    audio.addEventListener("canplay", startWhenReady);
    audio.addEventListener("error", unavailable);
    audio.load();

    // Listener lifetime follows this Audio instance, not playback-effect reruns.
    // A slow track can finish loading while paused and remain usable on resume.
    listenerCleanupRef.current = () => {
      disposed = true;
      audio.removeEventListener("canplay", startWhenReady);
      audio.removeEventListener("error", unavailable);
    };
  }, [
    disposeAudio,
    enabled,
    fadeToCurrentTarget,
    musicError,
    pause,
    shouldPlayStory,
    source,
  ]);

  useEffect(() => {
    fadeToCurrentTarget();
  }, [enabled, fadeToCurrentTarget, isNarrating, volume]);

  const toggle = useCallback(() => {
    if (!source || musicError || status === "unavailable") return;
    setEnabled(wasEnabled => {
      if (wasEnabled) stop();
      return !wasEnabled;
    });
  }, [musicError, source, status, stop]);

  const setVolume = useCallback((nextVolume: number) => {
    setVolumeState(clampMusicVolume(nextVolume));
  }, []);

  return {
    pause,
    stop,
    toggle,
    volume,
    setVolume,
    enabled,
    status,
    hasMusic: Boolean(source),
    label: source?.label || "",
    isLegacy: Boolean(source?.legacy),
  };
}

export function StoryPlayer({
  scenes,
  childName,
  isLoading,
  storyTheme,
  musicSelection,
  musicError,
}: StoryPlayerProps) {
  const [currentScene, setCurrentScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [showMusicControls, setShowMusicControls] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTTS = useBrowserTTS();
  const musicSource = useMemo(
    () => musicSourceFor(musicSelection, storyTheme),
    [musicSelection, storyTheme]
  );
  const bgm = useBackgroundMusic(
    musicSource,
    musicError,
    isPlaying && !isMuted,
    isNarrating && !isMuted
  );

  const completedScenes = scenes.filter(
    scene => scene.status === "completed" && scene.illustrationUrl
  );
  const totalScenes = completedScenes.length;
  const scene = completedScenes[currentScene];

  useEffect(() => {
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
      browserTTS.stop();
      bgm.stop();
    };
  }, [bgm.stop, browserTTS.stop]);

  // Polling can replace a signed scene URL while a story is shown. Always reset
  // to a valid scene instead of leaving an old audio element tied to stale data.
  useEffect(() => {
    if (currentScene >= totalScenes)
      setCurrentScene(Math.max(0, totalScenes - 1));
  }, [currentScene, totalScenes]);

  const advanceToNextScene = useCallback(() => {
    if (currentScene < totalScenes - 1) {
      setCurrentScene(previous => previous + 1);
    } else {
      setIsPlaying(false);
      setCurrentScene(0);
      bgm.stop();
    }
  }, [bgm.stop, currentScene, totalScenes]);

  // Narration remains independent of music. Changing a refreshed signed URL
  // disposes the old narration element and starts the current one, without
  // stopping the looping music source itself.
  useEffect(() => {
    if (!scene || !isPlaying) {
      audioRef.current?.pause();
      browserTTS.stop();
      setIsNarrating(false);
      if (progressInterval.current) clearInterval(progressInterval.current);
      return;
    }

    setIsNarrating(true);
    if (scene.narrationUrl) {
      browserTTS.stop();
      const audio = new Audio(scene.narrationUrl);
      audioRef.current = audio;
      audio.muted = isMuted;

      const metadata = () => setAudioDuration(audio.duration);
      const ended = () => advanceToNextScene();
      let disposed = false;
      const fallback = () => {
        if (!disposed && !isMuted)
          browserTTS.speak(scene.sceneText, advanceToNextScene);
      };
      audio.addEventListener("loadedmetadata", metadata);
      audio.addEventListener("ended", ended);
      audio.addEventListener("error", fallback);
      audio.play().catch(fallback);
      progressInterval.current = setInterval(
        () => setAudioProgress(audio.currentTime),
        100
      );

      return () => {
        disposed = true;
        audio.removeEventListener("loadedmetadata", metadata);
        audio.removeEventListener("ended", ended);
        audio.removeEventListener("error", fallback);
        audio.pause();
        audio.src = "";
        if (audioRef.current === audio) audioRef.current = null;
        browserTTS.stop();
        setIsNarrating(false);
        if (progressInterval.current) clearInterval(progressInterval.current);
      };
    }

    const wordCount = scene.sceneText.split(/\s+/).length;
    const estimatedDuration = Math.max(4, (wordCount / 150) * 60);
    setAudioDuration(estimatedDuration);
    setAudioProgress(0);
    if (!isMuted) {
      browserTTS.speak(scene.sceneText, advanceToNextScene);
    }
    const timer = isMuted
      ? setTimeout(advanceToNextScene, estimatedDuration * 1000)
      : undefined;
    const startTime = Date.now();
    progressInterval.current = setInterval(() => {
      setAudioProgress((Date.now() - startTime) / 1000);
    }, 100);

    return () => {
      if (timer) clearTimeout(timer);
      browserTTS.stop();
      setIsNarrating(false);
      if (progressInterval.current) clearInterval(progressInterval.current);
    };
  }, [
    advanceToNextScene,
    browserTTS,
    currentScene,
    isMuted,
    isPlaying,
    scene?.id,
    scene?.narrationUrl,
    scene?.sceneText,
  ]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = isMuted;
    browserTTS.setMuted(isMuted);
  }, [browserTTS, isMuted]);

  const togglePlay = useCallback(() => {
    if (totalScenes > 0) setIsPlaying(playing => !playing);
  }, [totalScenes]);

  const goToScene = useCallback(
    (index: number) => {
      if (index >= 0 && index < totalScenes) {
        setCurrentScene(index);
        setAudioProgress(0);
      }
    },
    [totalScenes]
  );

  const nextScene = useCallback(() => {
    if (currentScene < totalScenes - 1) goToScene(currentScene + 1);
  }, [currentScene, goToScene, totalScenes]);

  const prevScene = useCallback(() => {
    if (currentScene > 0) goToScene(currentScene - 1);
  }, [currentScene, goToScene]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.error);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.error);
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  if (isLoading) {
    return (
      <div className="bg-slate-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-purple-400" />
          <p className="text-lg font-medium">
            Creating your storybook video...
          </p>
          <p className="text-sm text-slate-400 mt-2">
            Generating illustrations and narration for each scene
          </p>
        </div>
      </div>
    );
  }

  if (totalScenes === 0) {
    const pendingCount = scenes.filter(
      entry => entry.status !== "completed" && entry.status !== "failed"
    ).length;
    const failedCount = scenes.filter(
      entry => entry.status === "failed"
    ).length;
    const completedCount = scenes.filter(
      entry => entry.status === "completed"
    ).length;
    return (
      <div className="bg-slate-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
        <div className="text-center text-white px-6 max-w-md">
          <Film className="w-12 h-12 mx-auto mb-4 text-purple-400" />
          <p className="text-lg font-medium">Animated Storybook</p>
          {pendingCount > 0 ? (
            <>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                <p className="text-sm text-slate-400">
                  Generating scenes... ({completedCount}/{scenes.length} ready)
                </p>
              </div>
              <div className="flex gap-2 justify-center mt-4">
                {scenes.map((entry, index) => (
                  <div
                    key={index}
                    className={`w-3 h-3 rounded-full ${
                      entry.status === "completed"
                        ? "bg-green-400"
                        : entry.status === "failed"
                          ? "bg-red-400"
                          : entry.status === "generating_image"
                            ? "bg-yellow-400 animate-pulse"
                            : entry.status === "generating_audio"
                              ? "bg-blue-400 animate-pulse"
                              : "bg-slate-600 animate-pulse"
                    }`}
                    title={`Scene ${index + 1}: ${entry.status}`}
                  />
                ))}
              </div>
              {failedCount > 0 && (
                <p className="text-xs text-red-400 mt-2">
                  {failedCount} scene(s) encountered an error. The video will
                  still be created with the remaining scenes.
                </p>
              )}
            </>
          ) : scenes.length > 0 ? (
            <p role="alert" className="text-sm text-red-300 mt-3">
              {failedCount > 0
                ? "Scene generation encountered an error. Please check the order status before retrying."
                : "Scene images are temporarily unavailable. Please refresh this page to renew access."}
            </p>
          ) : (
            <p className="text-sm text-slate-400 mt-2">
              Your animated storybook will appear here after payment
            </p>
          )}
        </div>
      </div>
    );
  }

  const musicStatusText =
    musicError || bgm.status === "unavailable"
      ? "Music unavailable."
      : bgm.status === "none"
        ? "No music selected."
        : bgm.status === "loading"
          ? "Music is loading."
          : bgm.status === "ready" && bgm.enabled
            ? "Music is on."
            : bgm.enabled
              ? "Music will load when story playback starts."
              : "Music is off.";
  const musicControlUnavailable =
    Boolean(musicError) || bgm.status === "unavailable";

  return (
    <div
      ref={containerRef}
      className={`bg-slate-900 rounded-2xl overflow-hidden relative group ${isFullscreen ? "fixed inset-0 z-50 rounded-none" : ""}`}
    >
      <div className="aspect-video relative overflow-hidden">
        <AnimatePresence mode="wait">
          {scene?.illustrationUrl && (
            <motion.div
              key={currentScene}
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{ opacity: 1, scale: isPlaying ? [1.0, 1.08] : 1.0 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.8 },
                scale: { duration: audioDuration || 8, ease: "linear" },
              }}
              className="absolute inset-0"
            >
              <img
                src={scene.illustrationUrl}
                alt={`Scene ${currentScene + 1}`}
                className="w-full h-full object-cover"
              />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <AnimatePresence mode="wait">
          {scene && (
            <motion.div
              key={`text-${currentScene}`}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="absolute bottom-16 left-0 right-0 px-8 pb-4"
            >
              <p className="text-white text-lg md:text-xl font-medium leading-relaxed text-center drop-shadow-lg max-w-3xl mx-auto">
                {scene.sceneText}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 text-white text-sm">
          {currentScene + 1} / {totalScenes}
        </div>
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-full px-4 py-1.5">
          <span className="text-white text-sm font-medium">
            {childName}'s Story
          </span>
        </div>
        {isPlaying && bgm.enabled && bgm.status === "ready" && !isMuted && (
          <div className="absolute top-12 left-4 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1.5">
            <Music className="w-3 h-3 text-purple-400 animate-pulse" />
            <span className="text-white/70 text-xs">{bgm.label}</span>
          </div>
        )}
        {scene && !scene.narrationUrl && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1">
            <span className="text-white/70 text-xs">
              {isMuted ? "Text only" : "Browser narration"}
            </span>
          </div>
        )}
        {!isPlaying && (
          <button
            aria-label="Play story"
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Play className="w-8 h-8 text-slate-900 ml-1" />
            </div>
          </button>
        )}
      </div>

      <div className="bg-slate-800/95 backdrop-blur-sm px-4 py-3">
        <div className="mb-3">
          <div className="flex gap-1">
            {completedScenes.map((_, index) => (
              <button
                key={index}
                aria-label={`Go to scene ${index + 1}`}
                onClick={() => goToScene(index)}
                className={`h-1.5 flex-1 rounded-full transition-all cursor-pointer ${index === currentScene ? "bg-purple-500" : index < currentScene ? "bg-purple-400/60" : "bg-slate-600"}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={prevScene}
              disabled={currentScene === 0}
              className="text-white hover:bg-white/10 disabled:opacity-30"
              aria-label="Previous scene"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={togglePlay}
              className="text-white hover:bg-white/10"
              aria-label={isPlaying ? "Pause story" : "Play story"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" />
              ) : (
                <Play className="w-5 h-5 ml-0.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={nextScene}
              disabled={currentScene === totalScenes - 1}
              className="text-white hover:bg-white/10 disabled:opacity-30"
              aria-label="Next scene"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowMusicControls(show => !show)}
                className={`text-white hover:bg-white/10 ${bgm.enabled && !musicControlUnavailable ? "text-purple-400" : "text-slate-500"}`}
                aria-label={
                  musicError
                    ? `Music unavailable: ${musicError}`
                    : "Music controls"
                }
                title={musicStatusText}
              >
                {bgm.enabled && !musicControlUnavailable && bgm.hasMusic ? (
                  <Music className="w-4 h-4" />
                ) : (
                  <Music2 className="w-4 h-4" />
                )}
              </Button>
              {showMusicControls && (
                <div className="absolute bottom-full right-0 mb-2 bg-slate-700 rounded-lg p-3 shadow-xl border border-slate-600 min-w-[230px] z-50">
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <span className="text-white text-xs font-medium">
                      Music
                    </span>
                    {bgm.hasMusic && !musicControlUnavailable && (
                      <button
                        onClick={bgm.toggle}
                        className={`text-xs px-2 py-0.5 rounded-full transition-colors ${bgm.enabled ? "bg-purple-600 text-white" : "bg-slate-600 text-slate-300"}`}
                        aria-label={`Turn music ${bgm.enabled ? "off" : "on"}`}
                      >
                        {bgm.enabled ? "On" : "Off"}
                      </button>
                    )}
                  </div>
                  <p
                    role={musicControlUnavailable ? "alert" : "status"}
                    className={`text-xs mb-2 ${musicControlUnavailable ? "text-amber-200" : "text-slate-300"}`}
                  >
                    {musicError || musicStatusText}
                  </p>
                  {bgm.hasMusic && !musicControlUnavailable && (
                    <div className="flex items-center gap-2">
                      <VolumeX className="w-3 h-3 text-slate-400 shrink-0" />
                      <input
                        type="range"
                        aria-label="Music volume"
                        min={MIN_MUSIC_VOLUME}
                        max={MAX_MUSIC_VOLUME}
                        step={0.01}
                        value={bgm.volume}
                        onChange={event =>
                          bgm.setVolume(parseFloat(event.target.value))
                        }
                        disabled={!bgm.enabled}
                        className="flex-1 h-1 accent-purple-500 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <Volume2 className="w-3 h-3 text-slate-400 shrink-0" />
                    </div>
                  )}
                  {bgm.hasMusic && (
                    <p className="text-slate-500 text-[10px] mt-1.5">
                      {bgm.label}
                      {bgm.isLegacy ? " (legacy soundtrack)" : ""}
                    </p>
                  )}
                  <p className="text-slate-500 text-[10px] mt-2">
                    Music controls affect live playback only; they do not change
                    your downloaded MP4.
                  </p>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMuted(muted => !muted)}
              className="text-white hover:bg-white/10"
              aria-label={
                isMuted
                  ? "Unmute narration and music"
                  : "Mute narration and music"
              }
            >
              {isMuted ? (
                <VolumeX className="w-4 h-4" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className="text-white hover:bg-white/10"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

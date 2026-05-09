import { useState, useRef, useEffect, useCallback } from "react";
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
import {
  THEME_BGM,
  DEFAULT_BGM_VOLUME,
  MIN_BGM_VOLUME,
  MAX_BGM_VOLUME,
} from "@/data/themeBgm";

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
}

/**
 * Use browser-native speech synthesis as fallback when no audio URL is available.
 */
function useBrowserTTS() {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = useCallback((text: string, onEnd: () => void) => {
    if (!("speechSynthesis" in window)) {
      // No browser TTS support - just auto-advance after a delay
      setTimeout(onEnd, Math.max(3000, text.length * 60));
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    utterance.pitch = 1.1;
    utterance.volume = 1;

    // Try to pick a friendly English voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.lang.startsWith("en") &&
        (v.name.toLowerCase().includes("samantha") ||
          v.name.toLowerCase().includes("karen") ||
          v.name.toLowerCase().includes("female") ||
          v.name.toLowerCase().includes("zira"))
    );
    if (preferred) utterance.voice = preferred;

    utterance.onend = onEnd;
    utterance.onerror = () => onEnd();
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    // Can't truly mute browser TTS, but we can set volume to 0
    if (utteranceRef.current) {
      utteranceRef.current.volume = muted ? 0 : 1;
    }
  }, []);

  return { speak, stop, setMuted };
}

/**
 * Hook to manage background music playback.
 * Handles loading, looping, volume control, and play/pause state.
 */
function useBackgroundMusic(theme: string | undefined) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [bgmVolume, setBgmVolume] = useState(DEFAULT_BGM_VOLUME);
  const [bgmEnabled, setBgmEnabled] = useState(true);
  const [bgmLoaded, setBgmLoaded] = useState(false);

  // Get the BGM URL for the current theme
  const bgmInfo = theme ? THEME_BGM[theme] : null;
  const bgmUrl = bgmInfo?.url;

  // Initialize or switch audio element when theme changes
  useEffect(() => {
    if (!bgmUrl) {
      setBgmLoaded(false);
      return;
    }

    const audio = new Audio(bgmUrl);
    audio.loop = true;
    audio.volume = bgmEnabled ? bgmVolume : 0;
    audio.preload = "auto";

    audio.addEventListener("canplaythrough", () => {
      setBgmLoaded(true);
    });

    audioRef.current = audio;

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
      setBgmLoaded(false);
    };
  }, [bgmUrl]);

  // Update volume when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = bgmEnabled ? bgmVolume : 0;
    }
  }, [bgmVolume, bgmEnabled]);

  const play = useCallback(() => {
    if (audioRef.current && bgmLoaded) {
      audioRef.current.play().catch(() => {
        // Autoplay may be blocked; will start on next user interaction
      });
    }
  }, [bgmLoaded]);

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, []);

  const toggle = useCallback(() => {
    setBgmEnabled((prev) => !prev);
  }, []);

  return {
    play,
    pause,
    stop,
    toggle,
    bgmVolume,
    setBgmVolume,
    bgmEnabled,
    setBgmEnabled,
    bgmLoaded,
    hasThemeMusic: !!bgmUrl,
    themeLabel: bgmInfo?.label || "",
  };
}

export function StoryPlayer({
  scenes,
  childName,
  isLoading,
  storyTheme,
}: StoryPlayerProps) {
  const [currentScene, setCurrentScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [showBgmControls, setShowBgmControls] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTTS = useBrowserTTS();
  const bgm = useBackgroundMusic(storyTheme);

  // Scenes are ready when they have an illustration (narration is optional)
  const completedScenes = scenes.filter(
    (s) => s.status === "completed" && s.illustrationUrl
  );
  const totalScenes = completedScenes.length;
  const scene = completedScenes[currentScene];

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (progressInterval.current) clearInterval(progressInterval.current);
      browserTTS.stop();
      bgm.stop();
    };
  }, []);

  // Sync BGM play/pause with player state
  useEffect(() => {
    if (isPlaying && bgm.bgmEnabled && bgm.hasThemeMusic) {
      bgm.play();
    } else {
      bgm.pause();
    }
  }, [isPlaying, bgm.bgmEnabled, bgm.hasThemeMusic]);

  // Mute BGM when narration is muted
  useEffect(() => {
    if (isMuted) {
      bgm.pause();
    } else if (isPlaying && bgm.bgmEnabled && bgm.hasThemeMusic) {
      bgm.play();
    }
  }, [isMuted]);

  const advanceToNextScene = useCallback(() => {
    if (currentScene < totalScenes - 1) {
      setCurrentScene((prev) => prev + 1);
    } else {
      setIsPlaying(false);
      setCurrentScene(0);
      bgm.stop();
    }
  }, [currentScene, totalScenes]);

  // Handle audio playback - either from URL or browser TTS
  useEffect(() => {
    if (!scene) return;
    if (!isPlaying) {
      // Stop any playing audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      browserTTS.stop();
      if (progressInterval.current) clearInterval(progressInterval.current);
      return;
    }

    // If scene has a narration URL, use the audio element
    if (scene.narrationUrl) {
      browserTTS.stop();
      const audio = new Audio(scene.narrationUrl);
      audioRef.current = audio;
      audio.muted = isMuted;

      audio.addEventListener("loadedmetadata", () => {
        setAudioDuration(audio.duration);
      });

      audio.addEventListener("ended", () => {
        advanceToNextScene();
      });

      audio.play().catch(console.error);
      progressInterval.current = setInterval(() => {
        setAudioProgress(audio.currentTime);
      }, 100);

      return () => {
        audio.pause();
        audio.src = "";
        if (progressInterval.current) clearInterval(progressInterval.current);
      };
    } else {
      // Use browser-native TTS as fallback
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      // Estimate duration based on text length (~150 words per minute)
      const wordCount = scene.sceneText.split(/\s+/).length;
      const estimatedDuration = Math.max(4, (wordCount / 150) * 60);
      setAudioDuration(estimatedDuration);
      setAudioProgress(0);

      if (!isMuted) {
        browserTTS.speak(scene.sceneText, advanceToNextScene);
      } else {
        // If muted, just auto-advance after estimated duration
        const timer = setTimeout(advanceToNextScene, estimatedDuration * 1000);
        return () => clearTimeout(timer);
      }

      // Track progress for browser TTS
      const startTime = Date.now();
      progressInterval.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        setAudioProgress(elapsed);
      }, 100);

      return () => {
        browserTTS.stop();
        if (progressInterval.current) clearInterval(progressInterval.current);
      };
    }
  }, [currentScene, isPlaying, scene?.narrationUrl, scene?.sceneText, isMuted]);

  // Update mute state
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isMuted;
    }
    browserTTS.setMuted(isMuted);
  }, [isMuted]);

  const togglePlay = useCallback(() => {
    if (totalScenes === 0) return;
    setIsPlaying((prev) => !prev);
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
    if (currentScene < totalScenes - 1) {
      goToScene(currentScene + 1);
    }
  }, [currentScene, totalScenes, goToScene]);

  const prevScene = useCallback(() => {
    if (currentScene > 0) {
      goToScene(currentScene - 1);
    }
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

  // Listen for fullscreen change
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-slate-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
        <div className="text-center text-white">
          <Loader2 className="w-12 h-12 animate-spin mx-auto mb-4 text-purple-400" />
          <p className="text-lg font-medium">Creating your storybook video...</p>
          <p className="text-sm text-slate-400 mt-2">
            Generating illustrations and narration for each scene
          </p>
        </div>
      </div>
    );
  }

  // No scenes yet
  if (totalScenes === 0) {
    const pendingCount = scenes.filter(
      (s) => s.status !== "completed" && s.status !== "failed"
    ).length;
    const failedCount = scenes.filter((s) => s.status === "failed").length;
    const completedCount = scenes.filter((s) => s.status === "completed").length;

    return (
      <div className="bg-slate-900 rounded-2xl overflow-hidden aspect-video flex items-center justify-center">
        <div className="text-center text-white px-6 max-w-md">
          <Film className="w-12 h-12 mx-auto mb-4 text-purple-400" />
          <p className="text-lg font-medium">Animated Storybook</p>
          {pendingCount > 0 || scenes.length > 0 ? (
            <>
              <div className="flex items-center justify-center gap-2 mt-3">
                <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                <p className="text-sm text-slate-400">
                  Generating scenes... (
                  {completedCount}/
                  {scenes.length} ready)
                </p>
              </div>
              {/* Scene progress indicators */}
              <div className="flex gap-2 justify-center mt-4">
                {scenes.map((s, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      s.status === "completed"
                        ? "bg-green-400"
                        : s.status === "failed"
                          ? "bg-red-400"
                          : s.status === "generating_image"
                            ? "bg-yellow-400 animate-pulse"
                            : s.status === "generating_audio"
                              ? "bg-blue-400 animate-pulse"
                              : "bg-slate-600 animate-pulse"
                    }`}
                    title={`Scene ${i + 1}: ${s.status}`}
                  />
                ))}
              </div>
              <div className="mt-4 p-3 bg-purple-900/30 rounded-lg border border-purple-500/20">
                <p className="text-sm text-purple-200">
                  Please allow <span className="font-semibold text-purple-100">3–5 minutes</span> for your video to fully render.
                </p>
                <p className="text-xs text-purple-300/70 mt-1">
                  Each scene's illustration and narration is being crafted individually. This page will update automatically — no need to refresh.
                </p>
              </div>
              {failedCount > 0 && (
                <p className="text-xs text-red-400 mt-2">
                  {failedCount} scene(s) encountered an error. The video will still be created with the remaining scenes.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400 mt-2">
              Your animated storybook will appear here after payment
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`bg-slate-900 rounded-2xl overflow-hidden relative group ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none" : ""
      }`}
    >
      {/* Main display area */}
      <div className="aspect-video relative overflow-hidden">
        <AnimatePresence mode="wait">
          {scene?.illustrationUrl && (
            <motion.div
              key={currentScene}
              initial={{ opacity: 0, scale: 1.1 }}
              animate={{
                opacity: 1,
                scale: isPlaying ? [1.0, 1.08] : 1.0,
              }}
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

        {/* Gradient overlay for text */}
        <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

        {/* Scene text overlay */}
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

        {/* Scene counter */}
        <div className="absolute top-4 right-4 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 text-white text-sm">
          {currentScene + 1} / {totalScenes}
        </div>

        {/* Title */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm rounded-full px-4 py-1.5">
          <span className="text-white text-sm font-medium">
            {childName}'s Story
          </span>
        </div>

        {/* BGM indicator (when playing) */}
        {isPlaying && bgm.bgmEnabled && bgm.hasThemeMusic && !isMuted && (
          <div className="absolute top-12 left-4 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1 flex items-center gap-1.5">
            <Music className="w-3 h-3 text-purple-400 animate-pulse" />
            <span className="text-white/70 text-xs">{bgm.themeLabel}</span>
          </div>
        )}

        {/* Narration type indicator */}
        {scene && !scene.narrationUrl && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1">
            <span className="text-white/70 text-xs">
              {isMuted ? "Text only" : "Browser narration"}
            </span>
          </div>
        )}

        {/* Center play button (when paused) */}
        {!isPlaying && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          >
            <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
              <Play className="w-8 h-8 text-slate-900 ml-1" />
            </div>
          </button>
        )}
      </div>

      {/* Controls bar */}
      <div className="bg-slate-800/95 backdrop-blur-sm px-4 py-3">
        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex gap-1">
            {completedScenes.map((_, i) => (
              <button
                key={i}
                onClick={() => goToScene(i)}
                className={`h-1.5 flex-1 rounded-full transition-all cursor-pointer ${
                  i === currentScene
                    ? "bg-purple-500"
                    : i < currentScene
                      ? "bg-purple-400/60"
                      : "bg-slate-600"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Control buttons */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={prevScene}
              disabled={currentScene === 0}
              className="text-white hover:bg-white/10 disabled:opacity-30"
            >
              <SkipBack className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={togglePlay}
              className="text-white hover:bg-white/10"
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
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {/* BGM toggle button */}
            {bgm.hasThemeMusic && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowBgmControls(!showBgmControls)}
                  className={`text-white hover:bg-white/10 ${
                    bgm.bgmEnabled ? "text-purple-400" : "text-slate-500"
                  }`}
                  title={`Background music: ${bgm.bgmEnabled ? "On" : "Off"}`}
                >
                  {bgm.bgmEnabled ? (
                    <Music className="w-4 h-4" />
                  ) : (
                    <Music2 className="w-4 h-4" />
                  )}
                </Button>

                {/* BGM volume popup */}
                {showBgmControls && (
                  <div className="absolute bottom-full right-0 mb-2 bg-slate-700 rounded-lg p-3 shadow-xl border border-slate-600 min-w-[200px] z-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white text-xs font-medium">
                        Background Music
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          bgm.toggle();
                        }}
                        className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                          bgm.bgmEnabled
                            ? "bg-purple-600 text-white"
                            : "bg-slate-600 text-slate-400"
                        }`}
                      >
                        {bgm.bgmEnabled ? "On" : "Off"}
                      </button>
                    </div>
                    {bgm.bgmEnabled && (
                      <div className="flex items-center gap-2">
                        <VolumeX className="w-3 h-3 text-slate-400 shrink-0" />
                        <input
                          type="range"
                          min={MIN_BGM_VOLUME}
                          max={MAX_BGM_VOLUME}
                          step={0.01}
                          value={bgm.bgmVolume}
                          onChange={(e) =>
                            bgm.setBgmVolume(parseFloat(e.target.value))
                          }
                          className="flex-1 h-1 accent-purple-500 cursor-pointer"
                        />
                        <Volume2 className="w-3 h-3 text-slate-400 shrink-0" />
                      </div>
                    )}
                    <p className="text-slate-500 text-[10px] mt-1.5">
                      {bgm.themeLabel} theme
                    </p>
                  </div>
                )}
              </div>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMuted(!isMuted)}
              className="text-white hover:bg-white/10"
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

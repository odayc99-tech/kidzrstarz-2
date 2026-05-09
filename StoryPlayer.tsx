import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Play, Pause, Volume2, VolumeX, ChevronLeft, ChevronRight } from "lucide-react";

interface Scene {
  id: number;
  sceneIndex: number;
  sceneText: string | null;
  illustrationUrl: string | null;
  narrationUrl: string | null;
  status: string;
}

interface StoryPlayerProps {
  scenes: Scene[];
  childName?: string | null;
  autoPlay?: boolean;
}

export default function StoryPlayer({ scenes, childName, autoPlay = false }: StoryPlayerProps) {
  const [currentScene, setCurrentScene] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [progress, setProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const completedScenes = scenes.filter(
    (s) => s.status === "completed" && s.illustrationUrl
  );

  const scene = completedScenes[currentScene];

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setProgress(0);
  }, [currentScene]);

  useEffect(() => {
    if (autoPlay && completedScenes.length > 0) {
      handlePlay();
    }
  }, []);

  const handlePlay = () => {
    if (!scene?.narrationUrl) return;

    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
        if (intervalRef.current) clearInterval(intervalRef.current);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
        startProgressTracking();
      }
      return;
    }

    const audio = new Audio(scene.narrationUrl);
    audio.muted = isMuted;
    audioRef.current = audio;

    audio.addEventListener("ended", () => {
      setIsPlaying(false);
      setProgress(100);
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Auto-advance to next scene
      if (currentScene < completedScenes.length - 1) {
        setTimeout(() => {
          setCurrentScene((prev) => prev + 1);
        }, 1000);
      }
    });

    audio.play();
    setIsPlaying(true);
    startProgressTracking();
  };

  const startProgressTracking = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      if (audioRef.current) {
        const { currentTime, duration } = audioRef.current;
        if (duration > 0) {
          setProgress((currentTime / duration) * 100);
        }
      }
    }, 100);
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
    }
    setIsMuted(!isMuted);
  };

  const goToScene = (index: number) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (intervalRef.current) clearInterval(intervalRef.current);
    setCurrentScene(index);
    setIsPlaying(false);
    setProgress(0);
  };

  if (completedScenes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>No scenes available yet. Generation in progress...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-purple-100">
      {/* Scene image */}
      <div className="relative aspect-video bg-gradient-to-br from-indigo-900 to-purple-900">
        {scene?.illustrationUrl ? (
          <img
            src={scene.illustrationUrl}
            alt={`Scene ${scene.sceneIndex}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-white/50 text-center">
              <div className="text-6xl mb-4">📖</div>
              <p>Scene {(scene?.sceneIndex ?? 0)}</p>
            </div>
          </div>
        )}

        {/* Scene counter badge */}
        <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm text-white text-sm font-medium px-3 py-1 rounded-full">
          Scene {currentScene + 1} of {completedScenes.length}
        </div>

        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={handlePlay}
            disabled={!scene?.narrationUrl}
            className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center hover:bg-white/30 transition-all hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-white/40"
          >
            {isPlaying ? (
              <Pause className="w-7 h-7 text-white" />
            ) : (
              <Play className="w-7 h-7 text-white ml-1" />
            )}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-purple-100">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Scene text */}
      <div className="p-6">
        <p className="text-slate-700 text-lg leading-relaxed text-center italic">
          "{scene?.sceneText || "..."}"
        </p>
      </div>

      {/* Controls */}
      <div className="px-6 pb-6 flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToScene(currentScene - 1)}
          disabled={currentScene === 0}
          className="border-purple-200 text-purple-700 hover:bg-purple-50"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </Button>

        <div className="flex items-center gap-2">
          {completedScenes.map((_, i) => (
            <button
              key={i}
              onClick={() => goToScene(i)}
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                i === currentScene
                  ? "bg-purple-600 scale-125"
                  : "bg-purple-200 hover:bg-purple-400"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            className="text-slate-500 hover:text-purple-600"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => goToScene(currentScene + 1)}
            disabled={currentScene === completedScenes.length - 1}
            className="border-purple-200 text-purple-700 hover:bg-purple-50"
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
}

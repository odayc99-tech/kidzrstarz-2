import { useCallback, useEffect, useRef, useState } from "react";
import { Music, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { MusicPreset } from "@shared/experienceCatalog";

type MusicSelection = MusicPreset["id"] | "none";

type ThemeMusicPickerProps = {
  music: MusicPreset[];
  selectedMusicId: MusicSelection;
  onChange: (musicId: MusicSelection) => void;
  disabled?: boolean;
};

/**
 * A catalog-only soundtrack selector. Audio previews are deliberately created
 * only from an explicit click; catalog availability controls whether a preset
 * can be selected or sampled.
 */
export function ThemeMusicPicker({
  music,
  selectedMusicId,
  onChange,
  disabled = false,
}: ThemeMusicPickerProps) {
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [sampleError, setSampleError] = useState<string | null>(null);

  const stopSample = useCallback(() => {
    if (sampleTimerRef.current) {
      clearTimeout(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  useEffect(() => {
    return () => stopSample();
  }, [stopSample]);

  // Changing a selection is a navigation event, not permission to keep audio playing.
  useEffect(() => {
    stopSample();
  }, [selectedMusicId, stopSample]);

  const playSample = useCallback(
    async (preset: MusicPreset) => {
      setSampleError(null);
      if (!preset.available) return;
      if (playingId === preset.id) {
        stopSample();
        return;
      }

      stopSample();
      if (typeof Audio === "undefined") {
        setSampleError("Audio samples are available in a browser.");
        return;
      }

      const audio = new Audio(preset.assetPath);
      activeAudioRef.current = audio;
      audio.onended = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
          setPlayingId(null);
        }
      };

      try {
        await audio.play();
        setPlayingId(preset.id);
        sampleTimerRef.current = setTimeout(() => {
          if (activeAudioRef.current === audio) stopSample();
        }, 10_000);
      } catch {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
        setPlayingId(null);
        setSampleError("This sample could not start. Please try again later.");
      }
    },
    [playingId, stopSample]
  );

  return (
    <section aria-labelledby="music-picker-title">
      <div className="flex items-start gap-2 mb-3">
        <div className="mt-0.5 w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
          <Music className="w-4 h-4 text-purple-600" />
        </div>
        <div>
          <h3
            id="music-picker-title"
            className="text-base font-semibold text-slate-800"
          >
            Music for your movie
          </h3>
          <p className="text-xs text-slate-500">
            Pick a gentle soundtrack, or choose no music. Samples play only when
            you press play.
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        <label
          className={`flex items-center gap-3 rounded-xl border-2 p-3 cursor-pointer transition-all ${
            selectedMusicId === "none"
              ? "border-purple-400 bg-purple-50 ring-2 ring-purple-100"
              : "border-slate-200 bg-white hover:border-purple-200"
          } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <input
            type="radio"
            name="soundtrack"
            value="none"
            checked={selectedMusicId === "none"}
            onChange={() => onChange("none")}
            disabled={disabled}
            className="sr-only"
          />
          <span className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
            <VolumeX className="w-4 h-4 text-slate-500" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-slate-800">
              No music
            </span>
            <span className="block text-xs text-slate-500">Narration only</span>
          </span>
          {selectedMusicId === "none" && (
            <span className="text-xs font-semibold text-purple-700">
              Selected
            </span>
          )}
        </label>

        {music.map(preset => {
          const selected = selectedMusicId === preset.id;
          const playing = playingId === preset.id;
          return (
            <div
              key={preset.id}
              className={`rounded-xl border-2 p-3 transition-all ${
                selected
                  ? "border-purple-400 bg-purple-50 ring-2 ring-purple-100"
                  : "border-slate-200 bg-white"
              } ${!preset.available ? "bg-slate-50 opacity-75" : "hover:border-purple-200"}`}
            >
              <div className="flex items-center gap-3">
                <label
                  className={`flex flex-1 items-center gap-3 min-w-0 ${preset.available && !disabled ? "cursor-pointer" : "cursor-not-allowed"}`}
                >
                  <input
                    type="radio"
                    name="soundtrack"
                    value={preset.id}
                    checked={selected}
                    onChange={() => onChange(preset.id)}
                    disabled={disabled || !preset.available}
                    className="sr-only"
                  />
                  <span className="w-9 h-9 shrink-0 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                    <Volume2 className="w-4 h-4 text-white" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800">
                      {preset.label}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {preset.description}
                    </span>
                  </span>
                </label>
                {preset.available ? (
                  <button
                    type="button"
                    aria-label={`${playing ? "Stop" : "Play"} ${preset.label} sample`}
                    aria-pressed={playing}
                    onClick={() => void playSample(preset)}
                    disabled={disabled}
                    className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-purple-700 hover:bg-purple-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {playing ? (
                      <Pause className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    {playing ? "Stop" : "Sample"}
                  </button>
                ) : (
                  <span className="shrink-0 rounded-full bg-slate-200 px-2 py-1 text-xs font-medium text-slate-600">
                    Unavailable
                  </span>
                )}
              </div>
              {selected && preset.available && (
                <p className="mt-2 text-xs font-semibold text-purple-700">
                  Selected
                </p>
              )}
            </div>
          );
        })}
      </div>
      {sampleError && (
        <p role="status" className="mt-2 text-xs text-amber-700">
          {sampleError}
        </p>
      )}
    </section>
  );
}

export type { MusicSelection };

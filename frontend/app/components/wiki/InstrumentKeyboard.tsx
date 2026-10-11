"use client";

import { useEffect, useRef, useState } from "react";
import type { InstrumentInfo, InstrumentKey } from "../../wiki/data";

function Key({
  keyData,
  label,
  onPlay,
  playing,
}: {
  keyData: InstrumentKey;
  label: string;
  onPlay: (key: InstrumentKey) => void;
  playing: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPlay(keyData)}
      className={`flex h-16 flex-1 flex-col items-center justify-center gap-0.5 rounded border text-sm font-semibold transition-all duration-100 sm:h-20 ${
        playing
          ? "-translate-y-0.5 border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_35%,var(--tfmc-forest))] text-[var(--tfmc-cream)] shadow-[0_4px_10px_rgba(0,0,0,0.4)]"
          : "border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,transparent)] text-[var(--tfmc-stone)] hover:border-[var(--tfmc-accent)] hover:text-[var(--tfmc-cream)]"
      }`}
    >
      <span className="text-base sm:text-lg">{keyData.note}</span>
      <span className="text-[10px] font-normal text-[var(--tfmc-mist)]">{label}</span>
    </button>
  );
}

const VOLUME_KEY = "tfmc-wiki-instrument-volume";

export default function InstrumentKeyboard({ instrument }: { instrument: InstrumentInfo }) {
  const poolRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const [activeSound, setActiveSound] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.7);

  useEffect(() => {
    const stored = window.localStorage.getItem(VOLUME_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed)) setVolume(parsed);
    }
  }, []);

  useEffect(() => {
    const pool = new Map<string, HTMLAudioElement>();
    for (const k of [...instrument.row1, ...instrument.row2]) {
      const audio = new Audio(k.sound);
      audio.preload = "auto";
      audio.volume = volume;
      audio.load();
      pool.set(k.sound, audio);
    }
    poolRef.current = pool;
    return () => {
      pool.forEach((audio) => {
        audio.pause();
        audio.src = "";
      });
      pool.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instrument]);

  useEffect(() => {
    poolRef.current.forEach((audio) => {
      audio.volume = volume;
    });
  }, [volume]);

  function handleVolumeChange(next: number) {
    setVolume(next);
    window.localStorage.setItem(VOLUME_KEY, String(next));
  }

  function play(key: InstrumentKey) {
    const audio = poolRef.current.get(key.sound);
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
    setActiveSound(key.sound);
    window.setTimeout(() => {
      setActiveSound((cur) => (cur === key.sound ? null : cur));
    }, 220);
  }

  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--tfmc-mist)]">
          Click a key to preview its sound: off-hand keys 1-8, and
          {instrument.mode === "chord" ? " Shift+1-8 for chords" : " Shift+1-8 for the octave above"}.
        </p>

        <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--tfmc-mist)]">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] accent-[var(--tfmc-accent)]"
            aria-label="Preview volume"
          />
          <span className="w-8 text-right tabular-nums">{Math.round(volume * 100)}%</span>
        </label>
      </div>

      <div className="mt-3 flex gap-1">
        {instrument.row1.map((k) => (
          <Key
            key={`row1-${k.num}`}
            keyData={k}
            label={String(k.num)}
            onPlay={play}
            playing={activeSound === k.sound}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {instrument.row2.map((k, i) => (
          <Key
            key={`row2-${k.num}`}
            keyData={k}
            label={instrument.mode === "chord" ? `Shift+${i + 1}` : String(k.num)}
            onPlay={play}
            playing={activeSound === k.sound}
          />
        ))}
      </div>
    </div>
  );
}

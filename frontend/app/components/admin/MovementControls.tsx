"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useAccessibleMaps } from "../../hooks/useAccessibleMaps";
import { liveMapIdFrom } from "../../lib/map/chronicleDayRoute";
import { fromLocalInput, toLocalInput } from "../../../lib/admin/movement";

const chipClass =
  "rounded-sm border px-2.5 py-1 text-sm transition-colors disabled:opacity-40";
const chipOn = "border-[var(--tfmc-accent)] text-[var(--tfmc-cream)]";
const chipOff =
  "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]";
const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-transparent px-2 py-1 text-sm text-[var(--tfmc-cream)] [color-scheme:dark]";

/** How often a window that ends now asks again: about one ping. */
const LIVE_REFRESH_MS = 60_000;

/** The map the site shows at /map: Main's on the public site, Dev's on the dev site, as CoreProtect is. */
export function useLiveMapId(): string | null {
  const { maps, loading, error } = useAccessibleMaps();
  if (loading) return null;
  return error ? "main" : liveMapIdFrom(maps);
}

export type Window = { duration: number; end: number | null };

/** The window asked for; `until` follows the clock while `end` is null. */
export function useMovementWindow(initial: Window) {
  const [win, setWin] = useState<Window>(initial);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (win.end !== null) return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), LIVE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [win.end]);
  const until = win.end ?? now;
  const change = useCallback((next: Window) => {
    setWin(next);
    setNow(Math.floor(Date.now() / 1000));
  }, []);
  return { win, change, since: until - win.duration, until };
}

export function WindowControls({
  presets,
  win,
  onChange,
  busy,
}: {
  presets: readonly { label: string; seconds: number }[];
  win: Window;
  onChange: (next: Window) => void;
  busy: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[var(--tfmc-mist)]">Last</span>
      {presets.map((preset) => (
        <button
          key={preset.seconds}
          type="button"
          aria-pressed={win.duration === preset.seconds}
          onClick={() => onChange({ ...win, duration: preset.seconds })}
          className={`${chipClass} ${win.duration === preset.seconds ? chipOn : chipOff}`}
        >
          {preset.label}
        </button>
      ))}
      <label className="ml-2 flex items-center gap-2 text-sm text-[var(--tfmc-mist)]">
        ending
        <input
          type="datetime-local"
          className={inputClass}
          value={win.end === null ? "" : toLocalInput(win.end)}
          onChange={(event) => onChange({ ...win, end: fromLocalInput(event.target.value) })}
        />
      </label>
      <button
        type="button"
        aria-pressed={win.end === null}
        onClick={() => onChange({ ...win, end: null })}
        className={`${chipClass} ${win.end === null ? chipOn : chipOff}`}
      >
        Now
      </button>
      {busy ? <span className="text-sm text-[var(--tfmc-mist)]">Loading…</span> : null}
    </div>
  );
}

/**
 * A moment inside the window. Null follows the newest moment, so a live
 * window keeps the marker on where the player is now.
 */
export function TimeSlider({
  since,
  until,
  cursor,
  onChange,
}: {
  since: number;
  until: number;
  cursor: number | null;
  onChange: (next: number | null) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const shown = cursor ?? until;
  const latest = useRef({ shown, since, until });
  latest.current = { shown, since, until };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const { shown: at, since: from, until: to } = latest.current;
      const step = Math.max(60, Math.round((to - from) / 240));
      const next = at >= to ? from : at + step;
      if (next >= to) {
        setPlaying(false);
        onChange(null);
      } else {
        onChange(next);
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [playing, onChange]);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => {
          if (!playing && shown >= until) onChange(since);
          setPlaying(!playing);
        }}
        className={`${chipClass} ${chipOff} w-16`}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        aria-label="Moment shown on the map"
        min={since}
        max={until}
        step={60}
        value={Math.min(until, Math.max(since, shown))}
        onChange={(event) => {
          setPlaying(false);
          const value = Number(event.target.value);
          onChange(value >= until ? null : value);
        }}
        className="flex-1 accent-[var(--tfmc-accent)]"
      />
      <span className="w-40 text-right text-sm tabular-nums text-[var(--tfmc-cream)]">
        {new Date(shown * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
      </span>
    </div>
  );
}

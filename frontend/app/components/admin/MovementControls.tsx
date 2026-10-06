"use client";

import { useEffect, useState, type ReactNode } from "react";

import type { MapPin } from "./MovementMap";
import { useAccessibleMaps } from "../../hooks/useAccessibleMaps";
import { liveMapIdFrom } from "../../lib/map/chronicleDayRoute";
import { formatDuration } from "../../../lib/admin/time";
import {
  describeSpan,
  formatClock,
  formatDay,
  formatMoment,
  parseLocalInput,
  stepObservation,
  timelineTicks,
  toLocalInput,
  zoneLabel,
} from "../../../lib/admin/movement";

export const chipClass =
  "min-h-11 rounded-sm border px-3 py-1 text-sm transition-colors disabled:opacity-40 sm:min-h-0";
export const chipOn = "border-[var(--tfmc-accent)] text-[var(--tfmc-cream)]";
export const chipOff =
  "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]";
export const inputClass =
  "min-h-11 w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-transparent px-2 py-1 text-sm text-[var(--tfmc-cream)] [color-scheme:dark] sm:min-h-0";
export const mutedClass = "text-sm text-[var(--tfmc-mist)]";
const errorClass = "text-sm text-[#e8a0a0]";

/** How often a range that follows the clock asks again: about one ping. */
export const FOLLOW_REFRESH_MS = 60_000;

/** The map the site shows at /map: Main's on the public site, Dev's on the dev site, as CoreProtect is. */
export function useLiveMapId(): string | null {
  const { maps, loading, error } = useAccessibleMaps();
  if (loading) return null;
  return error ? "main" : liveMapIdFrom(maps);
}

/** The server clock, ticking once a minute while `on`. */
export function useMinuteClock(on: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!on) return;
    setNow(Math.floor(Date.now() / 1000));
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), FOLLOW_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

export type Range = { from: number; to: number; follow: boolean };

export type Preset = { label: string; range: (now: number) => [number, number] };

function startOfLocalDay(at: number): number {
  const d = new Date(at * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

export function rangePresets(longest: number): Preset[] {
  const last = (label: string, seconds: number): Preset => ({ label, range: (now) => [now - seconds, now] });
  const presets: Preset[] = [
    last("Last 15 minutes", 15 * 60),
    last("Last hour", 3600),
    last("Last 6 hours", 6 * 3600),
    last("Last 24 hours", 86400),
    last("Last 7 days", 7 * 86400),
    { label: "Today", range: (now) => [startOfLocalDay(now), now] },
    {
      label: "Yesterday",
      range: (now) => {
        const today = startOfLocalDay(now);
        return [startOfLocalDay(today - 1), today];
      },
    },
  ];
  return presets.filter((preset) => {
    const [from, to] = preset.range(Math.floor(Date.now() / 1000));
    return to - from <= longest;
  });
}

/**
 * From and To, always filled in, applied together. A quick range fills both
 * and applies. "Keep up to date" moves the range forward with the clock.
 */
export function RangeForm({
  value,
  longest,
  asOf,
  onApply,
}: {
  value: Range;
  longest: number;
  asOf: number | null;
  onApply: (next: Range) => void;
}) {
  const [fromText, setFromText] = useState(toLocalInput(value.from));
  const [toText, setToText] = useState(toLocalInput(value.to));
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (seen.from !== value.from || seen.to !== value.to) {
    setSeen(value);
    setFromText(toLocalInput(value.from));
    setToText(toLocalInput(value.to));
  }

  const apply = (follow: boolean) => {
    const from = parseLocalInput(fromText);
    const to = parseLocalInput(toText);
    const problem = from.error ? `From: ${from.error}` : to.error ? `To: ${to.error}` : null;
    if (problem) return setError(problem);
    if (from.time! >= to.time!) return setError("From must be before To.");
    if (to.time! - from.time! > longest) return setError(`Choose a range of up to ${formatDuration(longest).toLowerCase()}.`);
    setError(null);
    onApply({ from: from.time!, to: to.time!, follow });
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply(false);
      }}
    >
      <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
        Quick range
        <select
          className={inputClass}
          value=""
          onChange={(event) => {
            const preset = rangePresets(longest).find((p) => p.label === event.target.value);
            if (!preset) return;
            const [from, to] = preset.range(Math.floor(Date.now() / 1000));
            setError(null);
            onApply({ from, to, follow: false });
          }}
        >
          <option value="">Choose…</option>
          {rangePresets(longest).map((preset) => (
            <option key={preset.label}>{preset.label}</option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
          From
          <input type="datetime-local" className={inputClass} value={fromText} onChange={(e) => setFromText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
          To
          <input type="datetime-local" className={inputClass} value={toText} onChange={(e) => setToText(e.target.value)} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${chipClass} ${chipOn}`}>
          Apply range
        </button>
        <button
          type="button"
          className={`${chipClass} ${chipOff}`}
          onClick={() => setToText(toLocalInput(Math.floor(Date.now() / 1000)))}
        >
          To now
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--tfmc-cream)]">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--tfmc-accent)]"
          checked={value.follow}
          onChange={(event) => {
            if (event.target.checked) {
              const now = Math.floor(Date.now() / 1000);
              onApply({ from: now - (value.to - value.from), to: now, follow: true });
            } else {
              onApply({ ...value, follow: false });
            }
          }}
        />
        Keep up to date (moves the range with the clock)
      </label>
      {error ? (
        <p className={errorClass} role="alert">
          {error}
        </p>
      ) : null}
      <p className={mutedClass}>
        Showing <span className="text-[var(--tfmc-cream)]">{describeSpan(value.from, value.to)}</span> ·{" "}
        {formatDuration(value.to - value.from).toLowerCase()} · times in {zoneLabel(value.from, value.to)}
        {value.follow && asOf ? ` · updated ${formatClock(asOf)}` : ""}
      </p>
    </form>
  );
}

/** A stretch of observation; `row` stacks one row per player when several are compared. */
export type TimelineBand = { from: number; to: number; colour?: string; row?: number };

/**
 * The whole span left to right, with what is known about it: bands where a
 * player was observed, hatching where nothing could have been (before the
 * available observations, or rows left out), and the inspected moment.
 * A gap between bands is "not observed", which is not proof of offline.
 */
export function Timeline({
  since,
  until,
  unknownUntil,
  unknownLabel,
  bands,
  cursor,
  onCursor,
}: {
  since: number;
  until: number;
  /** Before this, nothing is available (hatched). */
  unknownUntil: number | null;
  unknownLabel: string;
  bands: TimelineBand[];
  cursor: number;
  onCursor: (time: number) => void;
}) {
  const span = Math.max(1, until - since);
  const pct = (t: number) => `${(Math.min(Math.max(t, since), until) - since) / span * 100}%`;
  const ticks = timelineTicks(since, until);
  const daily = ticks.length > 1 && ticks[1] - ticks[0] >= 86400;
  const multiDay = formatDay(since) !== formatDay(until);
  const hatchEnd = unknownUntil !== null && unknownUntil > since ? Math.min(unknownUntil, until) : null;
  const rows = Math.max(1, ...bands.map((band) => (band.row ?? 0) + 1));
  const rowHeight = rows === 1 ? 20 : Math.max(4, Math.min(10, 40 / rows));
  const barHeight = rows === 1 ? 36 : rows * (rowHeight + 2) + 8;

  return (
    <div className="flex flex-col gap-1 select-none">
      <div className="flex justify-between text-xs text-[var(--tfmc-mist)]">
        <span>{formatMoment(since)}</span>
        <span>{formatMoment(until)}</span>
      </div>
      <div className="relative rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]" style={{ height: barHeight }}>
        {hatchEnd !== null ? (
          <div
            className="absolute inset-y-0 left-0"
            title={unknownLabel}
            style={{
              width: pct(hatchEnd),
              background:
                "repeating-linear-gradient(135deg, rgba(232,228,217,0.16) 0 4px, transparent 4px 9px)",
            }}
          />
        ) : null}
        {bands.map((band, i) => (
          <div
            key={i}
            className="absolute rounded-sm"
            style={{
              top: rows === 1 ? 8 : 4 + (band.row ?? 0) * (rowHeight + 2),
              height: rowHeight,
              left: pct(band.from),
              width: `max(3px, calc(${pct(band.to)} - ${pct(band.from)}))`,
              background: band.colour ?? "var(--tfmc-accent)",
              opacity: 0.85,
            }}
          />
        ))}
        {ticks.map((t) => (
          <div key={t} className="absolute bottom-0 h-2 border-l border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)]" style={{ left: pct(t) }} />
        ))}
        <div className="pointer-events-none absolute inset-y-[-3px] w-0.5 bg-white shadow" style={{ left: pct(cursor) }} />
        <input
          type="range"
          aria-label="Inspected moment"
          min={since}
          max={until}
          step={1}
          value={Math.min(until, Math.max(since, cursor))}
          onChange={(event) => onCursor(Number(event.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <div className="relative h-4 text-[11px] text-[var(--tfmc-mist)]">
        {ticks.map((t) => (
          <span key={t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(t) }}>
            {daily ? formatDay(t) : multiDay && formatClock(t) === "00:00" ? formatDay(t) : formatClock(t)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--tfmc-mist)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-[var(--tfmc-accent)]" /> observed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]" /> not
          observed (offline, or not recorded)
        </span>
        {hatchEnd !== null ? (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-4 rounded-sm"
              style={{ background: "repeating-linear-gradient(135deg, rgba(232,228,217,0.4) 0 2px, transparent 2px 4px)" }}
            />
            {unknownLabel}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The inspected moment: typed, stepped between observations, or dragged on
 * the timeline; `children` says what is known about it.
 */
export function InspectBar({
  cursor,
  since,
  until,
  times,
  onCursor,
  children,
}: {
  cursor: number;
  since: number;
  until: number;
  /** Observation times, oldest first. */
  times: readonly number[];
  onCursor: (time: number) => void;
  children: ReactNode;
}) {
  const [text, setText] = useState(toLocalInput(cursor));
  const [seen, setSeen] = useState(cursor);
  const [error, setError] = useState<string | null>(null);
  if (seen !== cursor) {
    setSeen(cursor);
    setText(toLocalInput(cursor));
  }
  const previous = stepObservation(times, cursor, -1);
  const next = stepObservation(times, cursor, 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
          Inspect time
          <input
            type="datetime-local"
            className={`${inputClass} sm:w-56`}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              const parsed = parseLocalInput(event.target.value);
              if (parsed.error) return setError(parsed.error);
              if (parsed.time! < since || parsed.time! > until) return setError("That time is outside the span shown.");
              setError(null);
              onCursor(parsed.time!);
            }}
          />
        </label>
        <button
          type="button"
          className={`${chipClass} ${chipOff}`}
          disabled={previous === null}
          onClick={() => previous !== null && onCursor(previous)}
        >
          ‹ Previous observation
        </button>
        <button
          type="button"
          className={`${chipClass} ${chipOff}`}
          disabled={next === null}
          onClick={() => next !== null && onCursor(next)}
        >
          Next observation ›
        </button>
      </div>
      {error ? (
        <p className={errorClass} role="alert">
          {error}
        </p>
      ) : null}
      <div className="text-sm text-[var(--tfmc-cream)]">{children}</div>
    </div>
  );
}

/** Copies text, saying so for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={`${chipClass} ${chipOff}`}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export /** An incident location to compare against, kept in the URL. */
function PinForm({ pin, onChange }: { pin: MapPin | null; onChange: (pin: MapPin | null) => void }) {
  const [x, setX] = useState(pin ? String(pin.x) : "");
  const [z, setZ] = useState(pin ? String(pin.z) : "");
  const valid = /^-?\d+$/.test(x.trim()) && /^-?\d+$/.test(z.trim());
  return (
    <form
      className="flex flex-col gap-1 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onChange({ x: Number(x.trim()), z: Number(z.trim()) });
      }}
    >
      <span className="text-sm text-[var(--tfmc-mist)]">Pin a place on the overworld map (for a report)</span>
      <div className="flex gap-2">
        <input aria-label="Pin x" placeholder="x" inputMode="numeric" className={inputClass} value={x} onChange={(e) => setX(e.target.value)} />
        <input aria-label="Pin z" placeholder="z" inputMode="numeric" className={inputClass} value={z} onChange={(e) => setZ(e.target.value)} />
        <button type="submit" disabled={!valid} className={`${chipClass} ${chipOff}`}>
          Pin
        </button>
        {pin ? (
          <button
            type="button"
            className={`${chipClass} ${chipOff}`}
            onClick={() => {
              setX("");
              setZ("");
              onChange(null);
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}

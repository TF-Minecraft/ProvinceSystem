"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { MapPin } from "./MovementMap";
import { useAccessibleMaps } from "../../hooks/useAccessibleMaps";
import { liveMapIdFrom } from "../../lib/map/chronicleDayRoute";
import { formatDuration } from "../../../lib/admin/time";
import {
  formatClock,
  formatDay,
  formatMoment,
  parseLocalInput,
  stepObservation,
  timelineTicks,
  toLocalInput,
  zoneLabel,
} from "../../../lib/admin/movement";

export const chipClass = "min-h-11 rounded-sm border px-3 py-1 text-sm transition-colors disabled:opacity-40";
export const chipOn = "border-[var(--tfmc-accent)] text-[var(--tfmc-cream)]";
export const chipOff =
  "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]";
// 16 px text on phones: iOS Safari zooms in on any smaller box it focuses.
export const inputClass =
  "min-h-11 w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-transparent px-2 py-1 text-base text-[var(--tfmc-cream)] [color-scheme:dark] sm:text-sm";
export const mutedClass = "text-sm text-[var(--tfmc-mist)]";
/**
 * Date and time boxes. Safari draws them at their own width, past a narrow
 * box, over whatever sits beside them; without its native appearance it
 * keeps to the width given. iOS also sets the value at the top of a taller
 * box, so the height is fixed and the value is centred on one line.
 */
export const dateInputClass = `${inputClass} block h-11 min-w-0 appearance-none py-0 leading-10 [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:text-left`;
const errorClass = "text-sm text-[#e8a0a0]";

/** How often a range that follows the clock asks again: about one ping. */
export const FOLLOW_REFRESH_MS = 60_000;
/**
 * Room under the everyone map for its timeline: up to eight rows of bands, its
 * labels and its key. Now keeps the same room, so switching views leaves the map as it is.
 */
export const EVERYONE_STRIP_HEIGHT = "9rem";

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

/** How long the inspected moment must rest before it is written to the URL. */
const MOMENT_WRITE_DELAY_MS = 300;

/**
 * The inspected moment while it is being moved: shown at once, written to the
 * URL (`at`) only once it rests, so dragging the timeline does not rewrite the
 * URL on every step. A change of `view` (the session or range shown) or of the
 * URL's own `at` (back and forward, a link) drops the moment being moved and
 * any write still pending; `cancel` does the same on demand.
 */
export function useLiveMoment(urlAt: number | null, view: string, writeAt: (time: number) => void) {
  const [live, setLive] = useState<number | null>(null);
  const [seenUrlAt, setSeenUrlAt] = useState(urlAt);
  const [seenView, setSeenView] = useState(view);
  if (seenView !== view) {
    setSeenView(view);
    setLive(null);
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const write = useRef(writeAt);
  write.current = writeAt;
  // The URL caught up, or changed for another reason: it is the truth again.
  if (seenUrlAt !== urlAt) {
    setSeenUrlAt(urlAt);
    setLive(null);
  }
  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setLive(null);
  }, []);
  const move = useCallback((time: number) => {
    const at = Math.round(time);
    setLive(at);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      write.current(at);
    }, MOMENT_WRITE_DELAY_MS);
  }, []);
  // Our own write clears the timer before it lands, so a pending timer here means the change came from elsewhere.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [urlAt, view]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { at: live ?? urlAt, move, cancel };
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
  // Typed but not applied: following the clock must not overwrite it.
  const [dirty, setDirty] = useState(false);
  if (seen.from !== value.from || seen.to !== value.to) {
    setSeen(value);
    if (!dirty) {
      setFromText(toLocalInput(value.from));
      setToText(toLocalInput(value.to));
    }
  }

  const apply = (follow: boolean) => {
    const from = parseLocalInput(fromText);
    const to = parseLocalInput(toText);
    const problem = from.error ? `From: ${from.error}` : to.error ? `To: ${to.error}` : null;
    if (problem) return setError(problem);
    if (from.time! >= to.time!) return setError("From must be before To.");
    if (to.time! - from.time! > longest) return setError(`Choose a range of up to ${formatDuration(longest).toLowerCase()}.`);
    setError(null);
    setDirty(false);
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
            setDirty(false);
            setFromText(toLocalInput(from));
            setToText(toLocalInput(to));
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
        <label className="flex min-w-0 flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
          From
          <input type="datetime-local" className={dateInputClass} value={fromText} onChange={(e) => { setFromText(e.target.value); setDirty(true); }} />
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
          To
          <input type="datetime-local" className={dateInputClass} value={toText} onChange={(e) => { setToText(e.target.value); setDirty(true); }} />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={`${chipClass} ${chipOn}`}>
          Apply range
        </button>
        <button
          type="button"
          className={`${chipClass} ${chipOff}`}
          onClick={() => {
            setToText(toLocalInput(Math.floor(Date.now() / 1000)));
            setDirty(true);
          }}
        >
          To now
        </button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-[var(--tfmc-cream)]">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--tfmc-accent)]"
          checked={value.follow}
          onChange={(event) => {
            if (event.target.checked) {
              const now = Math.floor(Date.now() / 1000);
              setDirty(false);
              setFromText(toLocalInput(now - (value.to - value.from)));
              setToText(toLocalInput(now));
              onApply({ from: now - (value.to - value.from), to: now, follow: true });
            } else {
              onApply({ ...value, follow: false });
            }
          }}
        />
        Move range with the clock
      </label>
      {error ? (
        <p className={errorClass} role="alert">
          {error}
        </p>
      ) : null}
      <p className={mutedClass}>
        {formatDuration(value.to - value.from)} · times in {zoneLabel(value.from, value.to)}
        {value.follow && asOf ? ` · updated ${formatClock(asOf)}` : ""}
      </p>
    </form>
  );
}

/** A stretch of observation; `row` stacks one row per player when several are compared. */
export type TimelineBand = { from: number; to: number; colour?: string; row?: number };

/** Within this many pixels of a band's edge, a drag lands on the edge: the moment they were first or last seen. */
const SNAP_PX = 6;
/** How far a finger moves sideways before it scrubs; a tap without moving still jumps there. */
const TOUCH_SLOP_PX = 4;
/** Room for about one tick label in this many pixels. */
const TICK_LABEL_PX = 80;
const chipBase = "absolute top-0 whitespace-nowrap rounded-sm px-1.5 text-[11px] leading-5 tabular-nums";

/**
 * The whole span left to right, with what is known about it: bands where a
 * player was observed, hatching where nothing could have been (before the
 * available observations, or rows left out), and the inspected moment.
 * A gap between bands is "not observed", which is not proof of offline.
 *
 * Press or drag anywhere on it to move the moment; a finger scrubs sideways and
 * still scrolls the page up and down. Arrow keys step a minute, Page Up and
 * Page Down a tenth of the span.
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
  const track = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; x: number; touch: boolean; moved: boolean } | null>(null);
  const frame = useRef<number | null>(null);
  const pending = useRef(0);
  const emit = useRef(onCursor);
  emit.current = onCursor;

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const span = Math.max(1, until - since);
  const clamp = (t: number) => Math.min(Math.max(t, since), until);
  const pct = (t: number) => `${(clamp(t) - since) / span * 100}%`;
  const px = (t: number) => (clamp(t) - since) / span * width;
  const most = width ? Math.max(2, Math.floor(width / TICK_LABEL_PX)) : 8;
  const ticks = timelineTicks(since, until, most);
  const minor = timelineTicks(since, until, most * 5).filter((t) => !ticks.includes(t));
  const daily = ticks.length > 1 && ticks[1] - ticks[0] >= 86400;
  const multiDay = formatDay(since) !== formatDay(until);
  const hatchEnd = unknownUntil !== null && unknownUntil > since ? Math.min(unknownUntil, until) : null;
  const rows = Math.max(1, ...bands.map((band) => (band.row ?? 0) + 1));
  const rowHeight = rows === 1 ? 20 : Math.max(4, Math.min(10, 40 / rows));
  const barHeight = rows === 1 ? 40 : rows * (rowHeight + 2) + 8;
  const at = clamp(cursor);
  const label = (t: number) =>
    `${multiDay ? `${formatDay(t)}, ` : ""}${formatClock(t, span <= 3 * 3600)}`;

  /** The time under a pointer, drawn to a nearby band edge when `snap`. */
  const timeAt = (clientX: number, snap: boolean) => {
    const rect = track.current!.getBoundingClientRect();
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    let time = since + (x / Math.max(1, rect.width)) * span;
    if (snap) {
      let reach = (SNAP_PX / Math.max(1, rect.width)) * span;
      for (const band of bands) {
        for (const edge of [band.from, band.to]) {
          if (edge >= since && edge <= until && Math.abs(edge - time) <= reach) {
            reach = Math.abs(edge - time);
            time = edge;
          }
        }
      }
    }
    return Math.round(time);
  };
  // At most once a frame, however fast the pointer moves: the map redraws on each.
  const moveTo = (time: number) => {
    pending.current = time;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      emit.current(pending.current);
    });
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const keyStep = (key: string, shift: boolean): number | null => {
    const minute = shift ? 600 : 60;
    switch (key) {
      case "ArrowLeft":
      case "ArrowDown":
        return at - minute;
      case "ArrowRight":
      case "ArrowUp":
        return at + minute;
      case "PageDown":
        return at - span / 10;
      case "PageUp":
        return at + span / 10;
      case "Home":
        return since;
      case "End":
        return until;
      default:
        return null;
    }
  };

  const showHover = hover !== null && !dragging && width > 0;

  // The time labels above the bar sit over their moment, kept inside the bar's ends; the hover
  // label gives way to the moment's, and the span's ends give way to both.
  useLayoutEffect(() => {
    const row = header.current;
    if (!row) return;
    const [start, end, ...chips] = Array.from(row.children) as HTMLElement[];
    const placed: [number, number][] = [];
    for (const chip of chips) {
      const w = chip.offsetWidth;
      const left = Math.min(Math.max(Number(chip.dataset.x) - w / 2, 0), Math.max(0, width - w));
      chip.style.left = `${left}px`;
      const clash = placed.some(([a, b]) => left < b + 4 && left + w > a - 4);
      chip.style.visibility = clash ? "hidden" : "";
      if (!clash) placed.unshift([left, left + w]);
    }
    for (const [label, a, b] of [[start, 0, start.offsetWidth], [end, width - end.offsetWidth, width]] as const) {
      label.style.visibility = placed.some(([l, r]) => l < b + 8 && r > a - 8) ? "hidden" : "";
    }
  });

  return (
    <div className="flex flex-col gap-1 select-none">
      {/* Placed by the layout effect above: the span's ends, the moment's label, then the hover's. */}
      <div ref={header} className="relative h-5 text-xs text-[var(--tfmc-mist)]">
        <span className="absolute left-0 top-0 leading-5">{formatMoment(since)}</span>
        <span className="absolute right-0 top-0 leading-5">{formatMoment(until)}</span>
        {width ? (
          <span className={`${chipBase} bg-[var(--tfmc-cream)] font-medium text-[var(--tfmc-forest-deep)]`} data-x={px(at)}>
            {label(at)}
          </span>
        ) : null}
        {showHover ? (
          <span
            className={`${chipBase} border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] bg-[var(--tfmc-forest-deep)] leading-[18px] text-[var(--tfmc-cream)]`}
            data-x={px(hover!)}
          >
            {label(hover!)}
          </span>
        ) : null}
      </div>
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label="Inspected moment"
        aria-valuemin={since}
        aria-valuemax={until}
        aria-valuenow={at}
        aria-valuetext={formatMoment(at, true)}
        className={`relative touch-pan-y rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tfmc-accent)] ${
          dragging ? "cursor-grabbing" : "cursor-pointer"
        }`}
        style={{ height: barHeight }}
        onKeyDown={(event) => {
          const next = keyStep(event.key, event.shiftKey);
          if (next === null) return;
          event.preventDefault();
          onCursor(Math.round(clamp(next)));
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          const touch = event.pointerType !== "mouse";
          drag.current = { id: event.pointerId, x: event.clientX, touch, moved: !touch };
          // A finger waits to see whether it is scrolling the page; a mouse takes hold at once.
          if (touch) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          setHover(null);
          moveTo(timeAt(event.clientX, true));
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" && !drag.current) setHover(timeAt(event.clientX, false));
          const d = drag.current;
          if (!d || d.id !== event.pointerId) return;
          if (!d.moved) {
            if (Math.abs(event.clientX - d.x) < TOUCH_SLOP_PX) return;
            d.moved = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
          }
          moveTo(timeAt(event.clientX, true));
        }}
        onPointerUp={(event) => {
          const d = drag.current;
          if (!d || d.id !== event.pointerId) return;
          if (!d.moved) moveTo(timeAt(event.clientX, true));
          endDrag();
        }}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHover(null)}
      >
        {hatchEnd !== null ? (
          <div
            className="absolute inset-y-0 left-0 rounded-l-sm"
            title={unknownLabel}
            style={{
              width: pct(hatchEnd),
              background:
                "repeating-linear-gradient(135deg, rgba(232,228,217,0.16) 0 4px, transparent 4px 9px)",
            }}
          />
        ) : null}
        {minor.map((t) => (
          <div key={t} className="absolute bottom-0 h-1 border-l border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]" style={{ left: pct(t) }} />
        ))}
        {ticks.map((t) => (
          <div key={t} className="absolute bottom-0 h-2 border-l border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)]" style={{ left: pct(t) }} />
        ))}
        {bands.map((band, i) => (
          <div
            key={i}
            className="absolute rounded-sm transition-opacity"
            style={{
              top: rows === 1 ? 10 : 4 + (band.row ?? 0) * (rowHeight + 2),
              height: rowHeight,
              left: pct(band.from),
              width: `max(3px, calc(${pct(band.to)} - ${pct(band.from)}))`,
              background: band.colour ?? "var(--tfmc-accent)",
              // The stretch under the moment stands out.
              opacity: band.from <= at && at <= band.to ? 1 : 0.7,
            }}
          />
        ))}
        {showHover ? (
          <div
            className="pointer-events-none absolute inset-y-0 w-px -translate-x-1/2 bg-[color-mix(in_srgb,var(--tfmc-cream)_55%,transparent)]"
            style={{ left: pct(hover!) }}
          />
        ) : null}
        {/* The playhead: a line through the bar with a grip on top, outside the bar's clipping. */}
        <div className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 -translate-x-1/2 bg-[var(--tfmc-cream)] shadow-[0_0_0_1px_rgba(15,28,22,0.6)]" style={{ left: pct(at) }}>
          <div className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-[var(--tfmc-cream)]" />
        </div>
      </div>
      <div className="relative h-4 text-[11px] text-[var(--tfmc-mist)]">
        {ticks.map((t) => (
          <span
            key={t}
            className={`absolute whitespace-nowrap ${px(t) < 24 ? "" : width - px(t) < 24 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: pct(t) }}
          >
            {daily ? formatDay(t) : multiDay && formatClock(t) === "00:00" ? formatDay(t) : formatClock(t)}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--tfmc-mist)]">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-[var(--tfmc-accent)]" /> seen
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-4 rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" /> not
          seen (not proof of offline)
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
      {/* The box on its own row, the steps together below it: nothing beside a date box to run into. */}
      <label className="flex w-full max-w-72 flex-col gap-1 text-sm text-[var(--tfmc-mist)]">
        Time
        <input
          type="datetime-local"
          className={dateInputClass}
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
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`${chipClass} ${chipOff}`}
          disabled={previous === null}
          onClick={() => previous !== null && onCursor(previous)}
        >
          ‹ Previous
        </button>
        <button
          type="button"
          className={`${chipClass} ${chipOff}`}
          disabled={next === null}
          onClick={() => next !== null && onCursor(next)}
        >
          Next ›
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
      <span className="text-sm text-[var(--tfmc-mist)]">Pin a place in the overworld</span>
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

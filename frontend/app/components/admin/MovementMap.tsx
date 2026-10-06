"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import MapViewport from "../map/MapViewport";
import TileLayer from "../map/TileLayer";
import { mapFallbackSize, type MapId } from "../map/types";
import { tileUrl, useTileManifest } from "../../hooks/useTileManifest";
import { useMapViewport } from "../../hooks/useMapViewport";
import { mapApiUrl } from "@/lib/map/api";
import { layoutLabels, type PlacedLabel } from "../../../lib/admin/labelLayout";
import {
  ACTION_LOGIN,
  ACTION_LOGOUT,
  ageColour,
  boundsOf,
  clipStretches,
  formatClock,
  isJump,
  positionAt,
  type Position,
  type Sample,
  type Stretch,
} from "../../../lib/admin/movement";

/** How many colour steps a player's trail fades through, old to new. */
const AGE_BANDS = 16;
/** Above this many rows the per-ping dots are left out; the line still shows every ping. */
const MAX_DOTS = 3000;
/** How close staff can zoom: screen pixels per block, far past the site map's limit. */
const MAX_PIXELS_PER_BLOCK = 12;
/** Smallest box the camera frames, in blocks, so one spot is not zoomed in to single pixels. */
const MIN_FRAME = 160;
/** Screen pixels between direction arrows along a path, and the most drawn at once. */
const ARROW_GAP_PX = 90;
const MAX_ARROWS = 400;
/** The part of a trail after the inspected moment is drawn this faint. */
const AFTER_OPACITY = 0.3;
const FOCUS_INSET = { left: 24, right: 24, top: 24, bottom: 24 };

export type MovementTrail = {
  key: string;
  label: string;
  stretches: Stretch[];
  /** A fixed colour (everyone view); otherwise the line fades from old to new. */
  colour?: string;
};

export type MapPin = { x: number; z: number };

type Props = {
  mapId: MapId;
  /** The CoreProtect world this map shows; rows in other worlds are not drawn. */
  mapWorld: string;
  trails: MovementTrail[];
  since: number;
  until: number;
  /** The inspected moment: a marker shows where each trail was then, and later parts are faint. */
  cursor: number;
  /** How long after their last row a player still counts as there (see `inspect`). */
  hold: number;
  /** A trail to draw over the others, with the rest dimmed. */
  highlight?: string | null;
  /** Label where each trail starts and ends (one player's view). */
  endpoints?: boolean;
  /** An incident location, independent of any player. */
  pin?: MapPin | null;
  /**
   * The camera frames the trails when this changes (a new session or range),
   * not when the same view refreshes. Pass null until its data has loaded.
   */
  fitKey: string | null;
  /** A recorded dot was clicked: inspect that moment. */
  onInspect?: (time: number) => void;
  /**
   * Each trail holds only a player's newest row: mark and label where they
   * are now, with no trail, and ignore `cursor` and `hold`.
   */
  latest?: boolean;
  className?: string;
};

type Band = { d: string; colour: string; after: boolean };

function pt(x: number, z: number): string {
  return `${x + 0.5} ${z + 0.5}`;
}

/** One path per colour band (split at the inspected moment) for walked steps, and the jumps. */
function trailPaths(trail: MovementTrail, mapWorld: string, since: number, until: number, cursor: number) {
  const span = Math.max(1, until - since);
  const bands = new Map<string, Band>();
  const jumps = { before: [] as string[], after: [] as string[] };
  for (const stretch of trail.stretches) {
    if (stretch.world !== mapWorld) continue;
    const s = stretch.samples;
    for (let i = 1; i < s.length; i += 1) {
      const a = s[i - 1];
      const b = s[i];
      const step = `M${pt(a.x, a.z)}L${pt(b.x, b.z)}`;
      const after = b.time > cursor;
      if (isJump(a, b)) {
        (after ? jumps.after : jumps.before).push(step);
        continue;
      }
      const colour =
        trail.colour ?? ageColour(Math.floor((((a.time + b.time) / 2 - since) / span) * AGE_BANDS) / (AGE_BANDS - 1));
      const id = `${colour}|${after}`;
      const band = bands.get(id) ?? { d: "", colour, after };
      band.d += step;
      bands.set(id, band);
    }
  }
  return { walked: [...bands.values()], jumpsBefore: jumps.before.join(""), jumpsAfter: jumps.after.join("") };
}

/** Chevrons along walked steps, `gap` blocks apart: x, z and heading in degrees. */
function arrows(trails: MovementTrail[], mapWorld: string, gap: number) {
  const out: { x: number; z: number; angle: number }[] = [];
  for (const trail of trails) {
    for (const stretch of trail.stretches) {
      if (stretch.world !== mapWorld) continue;
      let travelled = gap / 2;
      const s = stretch.samples;
      for (let i = 1; i < s.length && out.length < MAX_ARROWS; i += 1) {
        const a = s[i - 1];
        const b = s[i];
        if (isJump(a, b)) continue;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        let at = gap - travelled;
        while (at <= length && out.length < MAX_ARROWS) {
          const f = at / length;
          out.push({
            x: a.x + (b.x - a.x) * f,
            z: a.z + (b.z - a.z) * f,
            angle: (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI,
          });
          at += gap;
        }
        travelled = (travelled + length) % gap;
      }
    }
  }
  return out;
}

/** The first and last samples shown in the map's world, labelled for what they are. */
function endpointLabels(trail: MovementTrail, mapWorld: string): { sample: Sample; text: string }[] {
  const shown = trail.stretches.filter((s) => s.world === mapWorld);
  if (!shown.length) return [];
  const first = shown[0].samples[0];
  const lastStretch = shown[shown.length - 1].samples;
  const last = lastStretch[lastStretch.length - 1];
  const start = first.estimated
    ? `Shown from ${formatClock(first.time)} (estimated position)`
    : `${first.action === ACTION_LOGIN ? "Logged in" : "First observation shown"} ${formatClock(first.time)}`;
  const end = `${last.action === ACTION_LOGOUT ? "Logged out" : "Last observation shown"} ${formatClock(last.time)}`;
  if (first === last) return [{ sample: first, text: start }];
  return [
    { sample: first, text: start },
    { sample: last, text: end },
  ];
}

/** A trail's newest row and its world. */
function newestSample(trail: MovementTrail): { world: string | null; sample: Sample } | null {
  const stretch = trail.stretches[trail.stretches.length - 1];
  const sample = stretch?.samples[stretch.samples.length - 1];
  return sample ? { world: stretch.world, sample } : null;
}

function newestTitle(trail: MovementTrail, s: Sample): string {
  const recorded = s.action === ACTION_LOGIN ? "Logged in" : "Recorded";
  return `${trail.label} — ${s.x}, ${s.y}, ${s.z}\n${recorded} ${formatClock(s.time, true)}`;
}

type ShownLabel = {
  key: string;
  label: string;
  box: { x: number; y: number; width: number; height: number };
  leader: PlacedLabel["leader"];
  /** No room for it in the layout: shown anyway while pointed at or tapped. */
  forced: boolean;
};

const LABEL_FONT_PX = 13;
const LABEL_HEIGHT_PX = 16;
/** From a label box's top to its text's baseline. */
const LABEL_BASELINE = 12.5;

const widths = new Map<string, number>();
let measure: CanvasRenderingContext2D | null | undefined;

/** A name's width in screen pixels at the label font, measured once per name. */
function labelWidth(text: string): number {
  const known = widths.get(text);
  if (known !== undefined) return known;
  if (measure === undefined) {
    // jsdom has no canvas: estimate there.
    const canMeasure = typeof document !== "undefined" && !navigator.userAgent.includes("jsdom");
    measure = canMeasure ? document.createElement("canvas").getContext("2d") : null;
  }
  let width = text.length * LABEL_FONT_PX * 0.62;
  if (measure) {
    measure.font = `600 ${LABEL_FONT_PX}px ${getComputedStyle(document.body).fontFamily}`;
    width = measure.measureText(text).width;
  }
  widths.set(text, width);
  return width;
}

/** 1, 2 or 5 times a power of ten, at least `wanted`. */
function niceLength(wanted: number): number {
  const power = 10 ** Math.floor(Math.log10(Math.max(wanted, 1e-6)));
  const step = [1, 2, 5, 10].find((m) => m * power >= wanted) ?? 10;
  return step * power;
}

export default function MovementMap({
  mapId,
  mapWorld,
  trails,
  since,
  until,
  cursor,
  hold,
  highlight = null,
  endpoints = false,
  pin = null,
  fitKey,
  onInspect,
  latest = false,
  className,
}: Props) {
  const tiles = useTileManifest(mapId, "base", true);
  const [mapSize, setMapSize] = useState({ w: mapFallbackSize(mapId), h: mapFallbackSize(mapId) });
  const manifest = tiles.manifest;
  useEffect(() => {
    if (manifest) setMapSize({ w: manifest.width, h: manifest.height });
  }, [manifest]);

  const viewport = useMapViewport({
    mapSize,
    fitMode: "contain",
    dragPan: true,
    keyboard: false,
    restingZoom: true,
    maxDisplayScale: MAX_PIXELS_PER_BLOCK,
  });
  const { displayScale, focusMapRect, resetViewport, zoomBy, consumeDragClick } = viewport;
  const ready = viewport.viewportSize.w > 0;

  const tileView = useMemo(
    () => ({
      displayScale: viewport.displayScale,
      translateX: viewport.translateX,
      translateY: viewport.translateY,
      viewportW: viewport.viewportSize.w,
      viewportH: viewport.viewportSize.h,
    }),
    [viewport.displayScale, viewport.translateX, viewport.translateY, viewport.viewportSize.w, viewport.viewportSize.h]
  );

  // Drawn and framed: only the window. Markers read the full trails, which
  // carry the row before the window for where the player was as it opened.
  const shown = useMemo(
    () =>
      latest ? trails : trails.map((trail) => ({ ...trail, stretches: clipStretches(trail.stretches, since, until) })),
    [trails, since, until, latest]
  );
  const paths = useMemo(
    () => shown.map((trail) => ({ trail, ...trailPaths(trail, mapWorld, since, until, cursor) })),
    [shown, mapWorld, since, until, cursor]
  );
  const unit = displayScale > 0 ? 1 / displayScale : 1;
  const chevrons = useMemo(
    () => (displayScale > 0 ? arrows(shown, mapWorld, ARROW_GAP_PX / displayScale) : []),
    [shown, mapWorld, displayScale]
  );
  const bounds = useMemo(() => {
    const boxes = shown.map((t) => boundsOf(t.stretches, mapWorld)).filter((b) => b !== null);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
    const padW = Math.max(MIN_FRAME, w) - w;
    const padH = Math.max(MIN_FRAME, h) - h;
    return { x: x - padW / 2, y: y - padH / 2, w: w + padW, h: h + padH };
  }, [shown, mapWorld]);

  const fitTrail = () => (bounds ? focusMapRect(bounds, FOCUS_INSET) : resetViewport({ animated: true }));
  const focusPoint = (x: number, z: number) =>
    focusMapRect({ x: x - MIN_FRAME / 2, y: z - MIN_FRAME / 2, w: MIN_FRAME, h: MIN_FRAME }, FOCUS_INSET);

  // Frame a new selection once, when its data is in; refreshes keep the camera.
  const fittedRef = useRef<string | null>(null);
  // A marker tapped to show its name when there was no room for it.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || fitKey === null || fittedRef.current === fitKey) return;
    fittedRef.current = fitKey;
    if (bounds) focusMapRect(bounds, FOCUS_INSET);
    else if (pin) focusPoint(pin.x, pin.z);
    else resetViewport({ animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  const dots = shown.reduce((n, t) => n + t.stretches.reduce((m, s) => m + s.samples.length, 0), 0) <= MAX_DOTS;
  const markers = trails.map((trail) => {
    if (!latest) return { trail, at: positionAt(trail.stretches, cursor, hold), title: null };
    const newest = newestSample(trail);
    const at: Position | null = newest && { world: newest.world, x: newest.sample.x, z: newest.sample.z, exact: true };
    return {
      trail,
      at,
      title: newest && newestTitle(trail, newest.sample),
    };
  });
  const single = trails.length === 1 ? markers[0]?.at : null;

  // Laid out in pixels from the map's origin, so panning keeps the layout and only zooming redoes it.
  const named = trails.length > 1 || latest;
  const anchors = named
    ? markers.flatMap(({ trail, at }) =>
        at && at.world === mapWorld
          ? [{ key: trail.key, label: trail.label, x: (at.x + 0.5) * displayScale, y: (at.z + 0.5) * displayScale }]
          : []
      )
    : [];
  const layoutKey = anchors.map((a) => `${a.key}:${a.label}:${a.x.toFixed(1)}:${a.y.toFixed(1)}`).join("|");
  const placed = useMemo(
    () =>
      layoutLabels(
        anchors.map((a) => ({ key: a.key, x: a.x, y: a.y, width: labelWidth(a.label), height: LABEL_HEIGHT_PX }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey]
  );
  // A pick only stands while its name has no room: once zooming makes room, or the player is gone, it lapses,
  // so the name never comes back on its own later and the next tap picks it again.
  const pickLapsed =
    picked !== null && (placed.some((p) => p.key === picked) || !anchors.some((a) => a.key === picked));
  useEffect(() => {
    if (pickLapsed) setPicked(null);
  }, [pickLapsed]);
  const hiddenNames = anchors.length - placed.length;
  const labels = anchors.flatMap<ShownLabel>((anchor) => {
    const spot = placed.find((p) => p.key === anchor.key);
    if (spot) return [{ key: anchor.key, label: anchor.label, box: spot, leader: spot.leader, forced: false }];
    // No room: the label shows beside its marker, on a backing, only while pointed at or tapped.
    if (anchor.key !== highlight && (anchor.key !== picked || pickLapsed)) return [];
    const box = {
      x: anchor.x + 12,
      y: anchor.y - LABEL_HEIGHT_PX / 2,
      width: labelWidth(anchor.label),
      height: LABEL_HEIGHT_PX,
    };
    return [{ key: anchor.key, label: anchor.label, box, leader: null, forced: true }];
  });
  const scaleBlocks = displayScale > 0 ? niceLength(100 / displayScale) : 0;
  const halo = { stroke: "#10160f", strokeWidth: 3 * unit, paintOrder: "stroke" as const };
  /** Text beside a map point, flipped to its left when it would run off the right of the view. */
  const beside = (x: number, gap: number) => {
    const screenX = (x + 0.5) * displayScale + viewport.translateX;
    const flip = screenX > viewport.viewportSize.w - 220;
    return { x: x + 0.5 + (flip ? -gap : gap) * unit, textAnchor: flip ? ("end" as const) : ("start" as const) };
  };

  const dotTitle = (trail: MovementTrail, s: Sample) =>
    `${trail.label} — ${formatClock(s.time, true)}${
      s.action === ACTION_LOGIN ? " (logged in)" : s.action === ACTION_LOGOUT ? " (logged out)" : ""
    }\n${s.x}, ${s.y}, ${s.z}${onInspect ? "\nClick to inspect this moment" : ""}`;

  const controls = [
    { label: "+", title: "Zoom in", run: () => zoomBy(1.6) },
    { label: "−", title: "Zoom out", run: () => zoomBy(1 / 1.6) },
    { label: "⤢", title: latest ? "Fit everyone" : "Fit the trail", run: fitTrail },
    ...(single && single.world === mapWorld
      ? [{ label: "◎", title: "Go to the inspected position", run: () => focusPoint(single.x, single.z) }]
      : []),
    ...(pin ? [{ label: "⌖", title: "Go to the pin", run: () => focusPoint(pin.x, pin.z) }] : []),
  ];

  return (
    <div className={`relative overflow-hidden bg-[var(--tfmc-forest-deep)] ${className ?? ""}`}>
      <MapViewport
        mapSize={mapSize}
        viewportRef={viewport.viewportRef}
        contentRef={viewport.contentRef}
        transformStyle={viewport.transformStyle}
        transformTransition={viewport.transformTransition}
        zoom={viewport.zoom}
        cursorClassName={viewport.cursorClassName}
        isPanning={viewport.isPanning}
        fill
        capturesTouch
      >
        {manifest ? (
          <TileLayer
            manifest={manifest}
            onTileError={tiles.refresh}
            tileUrl={(level, x, y) => tileUrl(mapId, "base", manifest, level, x, y)}
            view={tileView}
            className={displayScale >= 1 ? "[image-rendering:pixelated]" : ""}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mapApiUrl(`/${mapId}/map/preview`)}
            alt="Map preview"
            className="pointer-events-none block h-full w-full"
          />
        )}
        <svg
          className="pointer-events-none absolute left-0 top-0 z-[13] h-full w-full"
          viewBox={`0 0 ${mapSize.w} ${mapSize.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {paths.map(({ trail, walked, jumpsBefore, jumpsAfter }) => {
            const dim = highlight !== null && highlight !== trail.key;
            const casing = walked.map((band) => band.d).join("");
            return (
              <g key={trail.key} opacity={dim ? 0.25 : 1}>
                {/* A dark edge so the line reads over snow, sand and forest alike. */}
                <path
                  d={casing}
                  fill="none"
                  stroke="#10160f"
                  strokeOpacity={0.55}
                  strokeWidth={5.5 * unit}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {walked.map((band) => (
                  <path
                    key={`${band.colour}|${band.after}`}
                    d={band.d}
                    fill="none"
                    stroke={band.colour}
                    strokeOpacity={band.after ? AFTER_OPACITY : 1}
                    strokeWidth={3 * unit}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {[
                  { d: jumpsBefore, opacity: 0.8 },
                  { d: jumpsAfter, opacity: AFTER_OPACITY },
                ].map((jump, i) =>
                  jump.d ? (
                    <path
                      key={i}
                      d={jump.d}
                      fill="none"
                      stroke={trail.colour ?? "#e8e4d9"}
                      strokeOpacity={jump.opacity}
                      strokeWidth={1.5 * unit}
                      strokeDasharray={`${6 * unit} ${5 * unit}`}
                    />
                  ) : null
                )}
                {trail.stretches.map((stretch) =>
                  stretch.world === mapWorld && !latest
                    ? stretch.samples.map((s, i) => {
                        const edge = s.action === ACTION_LOGIN || s.action === ACTION_LOGOUT;
                        // A point made up at the range's edge is drawn through, never as a recorded dot.
                        if (s.estimated || (!edge && !dots)) return null;
                        const fill =
                          s.action === ACTION_LOGIN
                            ? "#7fd18b"
                            : s.action === ACTION_LOGOUT
                              ? "#e8796f"
                              : (trail.colour ?? ageColour((s.time - since) / Math.max(1, until - since)));
                        return (
                          <circle
                            key={`${s.time}:${i}`}
                            cx={s.x + 0.5}
                            cy={s.z + 0.5}
                            r={(edge ? 5 : 2.5) * unit}
                            fill={fill}
                            fillOpacity={s.time > cursor ? AFTER_OPACITY : 1}
                            stroke={edge ? "#1b241d" : "none"}
                            strokeWidth={1.5 * unit}
                            className={onInspect ? "pointer-events-auto cursor-pointer" : "pointer-events-auto"}
                            onClick={
                              onInspect
                                ? () => {
                                    if (!consumeDragClick()) onInspect(s.time);
                                  }
                                : undefined
                            }
                          >
                            <title>{dotTitle(trail, s)}</title>
                          </circle>
                        );
                      })
                    : null
                )}
              </g>
            );
          })}
          {chevrons.map((c, i) => (
            <path
              key={i}
              d="M -3.5 -3 L 1.5 0 L -3.5 3"
              transform={`translate(${c.x + 0.5} ${c.z + 0.5}) rotate(${c.angle}) scale(${unit})`}
              fill="none"
              stroke="#fff"
              strokeOpacity={0.85}
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {endpoints
            ? shown.flatMap((trail) => {
                const labels = endpointLabels(trail, mapWorld);
                // Endpoints within a few screen pixels share one label.
                if (
                  labels.length === 2 &&
                  Math.hypot(labels[0].sample.x - labels[1].sample.x, labels[0].sample.z - labels[1].sample.z) < 30 * unit
                ) {
                  labels.splice(0, 2, { sample: labels[1].sample, text: `${labels[0].text} · ${labels[1].text}` });
                }
                return labels.map((label, i) => (
                  <text
                    key={`${trail.key}:label:${i}`}
                    {...beside(label.sample.x, 9)}
                    y={label.sample.z + 0.5 - 7 * unit}
                    fontSize={12 * unit}
                    fontWeight={600}
                    fill="#f3efe4"
                    {...halo}
                  >
                    {label.text}
                  </text>
                ));
              })
            : null}
          {pin ? (
            <g>
              <circle cx={pin.x + 0.5} cy={pin.z + 0.5} r={9 * unit} fill="none" stroke="#ff5a5a" strokeWidth={2.5 * unit} />
              <path
                d={`M ${pin.x + 0.5 - 14 * unit} ${pin.z + 0.5} H ${pin.x + 0.5 + 14 * unit} M ${pin.x + 0.5} ${
                  pin.z + 0.5 - 14 * unit
                } V ${pin.z + 0.5 + 14 * unit}`}
                stroke="#ff5a5a"
                strokeWidth={1.5 * unit}
              />
              <text
                {...beside(pin.x, 12)}
                y={pin.z + 0.5 + 16 * unit}
                fontSize={12 * unit}
                fontWeight={600}
                fill="#ffd0d0"
                {...halo}
              >
                {`Pin ${pin.x}, ${pin.z}`}
              </text>
            </g>
          ) : null}
          {/* Leader lines go under the markers, so one never draws across a dot. */}
          {labels.map(({ key, leader }) =>
            leader ? (
              <g key={`leader:${key}`} opacity={highlight !== null && highlight !== key ? 0.35 : 1}>
                <line
                  x1={leader.x1 * unit}
                  y1={leader.y1 * unit}
                  x2={leader.x2 * unit}
                  y2={leader.y2 * unit}
                  stroke="#10160f"
                  strokeOpacity={0.7}
                  strokeWidth={3 * unit}
                  strokeLinecap="round"
                />
                <line
                  x1={leader.x1 * unit}
                  y1={leader.y1 * unit}
                  x2={leader.x2 * unit}
                  y2={leader.y2 * unit}
                  stroke="#f3efe4"
                  strokeWidth={1.25 * unit}
                  strokeLinecap="round"
                />
              </g>
            ) : null
          )}
          {markers.map(({ trail, at, title }) => {
            if (!at || at.world !== mapWorld) return null;
            const dim = highlight !== null && highlight !== trail.key;
            const colour = trail.colour ?? "#f4c96b";
            return (
              <g
                key={`cursor:${trail.key}`}
                opacity={dim ? 0.35 : 1}
                className={latest ? "pointer-events-auto cursor-pointer" : undefined}
                onClick={
                  latest
                    ? () => {
                        if (!consumeDragClick()) setPicked((key) => (key === trail.key ? null : trail.key));
                      }
                    : undefined
                }
              >
                {title ? <title>{title}</title> : null}
                {/* Solid: recorded at this second. Hollow: estimated or last seen. */}
                <circle
                  cx={at.x + 0.5}
                  cy={at.z + 0.5}
                  r={8 * unit}
                  fill={at.exact ? colour : "rgba(16,22,15,0.35)"}
                  stroke={at.exact ? "#fff" : colour}
                  strokeWidth={(at.exact ? 2.5 : 3) * unit}
                  strokeDasharray={at.lastSeen !== undefined ? `${3 * unit} ${2.5 * unit}` : undefined}
                />
              </g>
            );
          })}
          {/* Names over every marker: beside it, or at the end of its leader line when crowded. */}
          {labels.map(({ key, label, box, forced }) => {
            const dim = highlight !== null && highlight !== key;
            return (
              <g key={`label:${key}`} opacity={dim ? 0.35 : 1}>
                {forced ? (
                  <rect
                    x={(box.x - 3) * unit}
                    y={(box.y - 1) * unit}
                    width={(box.width + 6) * unit}
                    height={(box.height + 2) * unit}
                    rx={3 * unit}
                    fill="#10160f"
                    fillOpacity={0.85}
                  />
                ) : null}
                <text
                  x={box.x * unit}
                  y={(box.y + LABEL_BASELINE) * unit}
                  fontSize={LABEL_FONT_PX * unit}
                  fontWeight={600}
                  fill="#fff"
                  {...halo}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </svg>
      </MapViewport>
      <div className="absolute right-3 top-3 z-20 flex flex-col gap-1">
        {controls.map((button) => (
          <button
            key={button.title}
            type="button"
            title={button.title}
            aria-label={button.title}
            onClick={button.run}
            className="h-11 w-11 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_85%,transparent)] text-lg text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)]"
          >
            {button.label}
          </button>
        ))}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-20 flex w-fit max-w-[calc(100%-1rem)] flex-col gap-1 rounded-sm bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_82%,transparent)] px-2.5 py-1.5 text-[11px] text-[var(--tfmc-cream)]">
        {hiddenNames > 0 ? (
          <span>
            {hiddenNames} {hiddenNames === 1 ? "name" : "names"} hidden for room: zoom in
            {latest ? " or tap a dot" : ""}
          </span>
        ) : null}
        {latest ? (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white bg-[#f4c96b]" /> last recorded
            position (once a minute)
          </span>
        ) : (
          <>
            {trails.length === 1 && !trails[0].colour ? (
              <span className="flex items-center gap-1.5">
                older
                <span
                  className="inline-block h-1.5 w-16 rounded-full"
                  style={{ background: `linear-gradient(to right, ${ageColour(0)}, ${ageColour(0.5)}, ${ageColour(1)})` }}
                />
                newer
              </span>
            ) : null}
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-white bg-[#f4c96b]" /> recorded
              <span className="ml-2 inline-block h-2.5 w-2.5 rounded-full border-2 border-[#f4c96b]" /> estimate or last seen
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="inline-block w-5 border-t-2 border-dashed border-[#e8e4d9]" /> unobserved transition
              <span className="ml-2 inline-block h-2 w-2 rounded-full bg-[#7fd18b]" /> logged in
              <span className="inline-block h-2 w-2 rounded-full bg-[#e8796f]" /> logged out
            </span>
          </>
        )}
      </div>
      {scaleBlocks ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded-sm bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_82%,transparent)] px-2 py-1 text-[11px] text-[var(--tfmc-cream)]">
          <div
            className="border-x-2 border-b-2 border-[var(--tfmc-cream)]"
            style={{ width: scaleBlocks * displayScale, height: 5 }}
          />
          {scaleBlocks.toLocaleString("en-GB")} {scaleBlocks === 1 ? "block" : "blocks"}
        </div>
      ) : null}
    </div>
  );
}

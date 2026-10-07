"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import MapViewport from "../map/MapViewport";
import TileLayer from "../map/TileLayer";
import { mapFallbackSize, type MapId } from "../map/types";
import { tileUrl, useTileManifest } from "../../hooks/useTileManifest";
import { useMapViewport } from "../../hooks/useMapViewport";
import { mapApiUrl } from "@/lib/map/api";
import { layoutLabels } from "../../../lib/admin/labelLayout";
import {
  blocks,
  boundsOfPoints,
  lineColour,
  terminals,
  type Bounds,
  type RailNetwork,
  type RailPoint,
} from "../../../lib/admin/rail";
import { LABEL_BASELINE, LABEL_FONT_PX, LABEL_HEIGHT_PX, labelWidth, niceLength } from "./MovementMap";

/** How close staff can zoom: screen pixels per block. */
const MAX_PIXELS_PER_BLOCK = 12;
/** Smallest box the camera frames, in blocks. */
const MIN_FRAME = 120;
const FOCUS_INSET = { left: 24, right: 24, top: 24, bottom: 24 };
/** Lines fill most of the view, and a stop or break can be framed close up. */
const FRAMING = { fill: 0.9, maxUserScale: 16 };
/** A settlement further than this from its stop is drawn too, joined to the stop. */
const SHOW_SETTLEMENT_BLOCKS = 30;
const BROKEN = "#ff4d4d";
/** Broken track is drawn as black and white hazard dashes, unlike any line's colour. */
const HAZARD = "#ffffff";
const DAMAGED = "#ffb547";
const CASING = "#10160f";

/** Something to frame: a stop, a broken stretch or a whole line. */
export type RailFocus = { key: string; bounds: Bounds };

type Props = {
  mapId: MapId;
  network: RailNetwork;
  /** A line to draw over the others, with the rest dimmed. */
  highlight?: number | null;
  /** Framed whenever its key changes. */
  focus?: RailFocus | null;
  className?: string;
};

function pathOf(points: RailPoint[]): string {
  return points.map(([x, z], i) => `${i ? "L" : "M"}${x} ${z}`).join("");
}

export function networkBounds(network: RailNetwork): Bounds | null {
  return boundsOfPoints(
    network.tracks.flatMap((t) => t.points),
    MIN_FRAME
  );
}

export function pointFocus(key: string, [x, z]: RailPoint): RailFocus {
  return { key, bounds: { x: x - MIN_FRAME / 2, y: z - MIN_FRAME / 2, w: MIN_FRAME, h: MIN_FRAME } };
}

export default function RailMap({ mapId, network, highlight = null, focus = null, className }: Props) {
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
  const { displayScale, focusMapRect, resetViewport, zoomBy } = viewport;
  const ready = viewport.viewportSize.w > 0;
  const unit = displayScale > 0 ? 1 / displayScale : 1;

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

  const lines = useMemo(() => new Map(network.lines.map((l) => [l.id, l])), [network.lines]);
  const colourOf = (line: number) => lineColour(lines.get(line));
  const dim = (line: number) => (highlight !== null && highlight !== line ? 0.3 : 1);
  const ends = useMemo(() => terminals(network), [network]);
  const bounds = useMemo(() => networkBounds(network), [network]);

  const fitNetwork = () =>
    bounds ? focusMapRect(bounds, FOCUS_INSET, FRAMING) : resetViewport({ animated: true });

  // Frame the network once the map's real size is known (a size change refits the whole map),
  // then whatever is picked from the list.
  const framedRef = useRef<string | null>(null);
  const target = focus ?? (bounds ? { key: "network", bounds } : null);
  useEffect(() => {
    if (!ready || !manifest || !target || framedRef.current === target.key) return;
    framedRef.current = target.key;
    focusMapRect(target.bounds, FOCUS_INSET, FRAMING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, manifest, target?.key]);

  // Stop names, laid out in screen pixels from the map's origin like the movement map's.
  const anchors = network.stops.map((stop, i) => ({
    key: `${i}`,
    label: stop.name,
    x: stop.at[0] * displayScale,
    y: stop.at[1] * displayScale,
  }));
  const layoutKey = `${displayScale.toFixed(4)}|${anchors.map((a) => a.label).join("|")}`;
  const placed = useMemo(
    () =>
      layoutLabels(
        anchors.map((a) => ({ key: a.key, x: a.x, y: a.y, width: labelWidth(a.label), height: LABEL_HEIGHT_PX }))
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layoutKey]
  );
  const hiddenNames = anchors.length - placed.length;
  const halo = { stroke: CASING, strokeWidth: 3 * unit, paintOrder: "stroke" as const };
  const scaleBlocks = displayScale > 0 ? niceLength(100 / displayScale) : 0;
  const broken = network.tracks.flatMap((t) => t.broken.map((s) => ({ ...s, line: t.line })));
  const damaged = network.tracks.flatMap((t) => t.damaged.map((s) => ({ ...s, line: t.line })));

  const controls = [
    { label: "+", title: "Zoom in", run: () => zoomBy(1.6) },
    { label: "−", title: "Zoom out", run: () => zoomBy(1 / 1.6) },
    { label: "⤢", title: "Fit the network", run: fitNetwork },
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
          {/* Settlements away from the track, joined to their stop. */}
          {network.stops.map((stop, i) =>
            stop.distance > SHOW_SETTLEMENT_BLOCKS ? (
              <g key={`settlement:${i}`} opacity={dim(stop.line)}>
                <path
                  d={pathOf([stop.at, stop.settlement])}
                  stroke="#f3efe4"
                  strokeOpacity={0.7}
                  strokeWidth={1.25 * unit}
                  strokeDasharray={`${4 * unit} ${3 * unit}`}
                  fill="none"
                />
                <rect
                  x={stop.settlement[0] - 3.5 * unit}
                  y={stop.settlement[1] - 3.5 * unit}
                  width={7 * unit}
                  height={7 * unit}
                  transform={`rotate(45 ${stop.settlement[0]} ${stop.settlement[1]})`}
                  fill="#f3efe4"
                  stroke={CASING}
                  strokeWidth={1.25 * unit}
                />
              </g>
            ) : null
          )}
          {/* Every track: a dark casing so the line reads over snow, sand and forest alike. */}
          {network.tracks.map((track) => (
            <g key={track.id} opacity={dim(track.line)}>
              <path
                d={pathOf(track.points)}
                fill="none"
                stroke={CASING}
                strokeOpacity={0.7}
                strokeWidth={7 * unit}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={pathOf(track.points)}
                fill="none"
                stroke={colourOf(track.line)}
                strokeWidth={4 * unit}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <title>{`${lines.get(track.line)?.name ?? "Track"}: ${blocks(track.length)}`}</title>
              </path>
            </g>
          ))}
          {[
            { list: damaged, colour: DAMAGED, dash: DAMAGED, label: "Damaged" },
            { list: broken, colour: BROKEN, dash: HAZARD, label: "Broken" },
          ].map(({ list, colour, dash, label }) =>
            list.map((s, i) => (
              <g key={`${label}:${i}`} opacity={dim(s.line)}>
                <path
                  d={pathOf(s.points)}
                  fill="none"
                  stroke={CASING}
                  strokeWidth={9 * unit}
                  strokeLinecap="round"
                />
                <path
                  d={pathOf(s.points)}
                  fill="none"
                  stroke={dash}
                  strokeWidth={5 * unit}
                  strokeDasharray={`${3 * unit} ${3 * unit}`}
                />
                {/* A ring keeps a stretch of a few blocks visible zoomed out. */}
                <circle
                  cx={s.points[0][0]}
                  cy={s.points[0][1]}
                  r={9 * unit}
                  fill="none"
                  stroke={colour}
                  strokeWidth={2.5 * unit}
                >
                  <title>{`${label}: ${blocks(s.to - s.from)}, ${Math.round(s.from).toLocaleString("en-GB")} blocks along`}</title>
                </circle>
              </g>
            ))
          )}
          {/* End of track: a bar across the line, as on an Underground map. */}
          {ends.map(({ at, towards, line }, i) => {
            const dx = at[0] - towards[0];
            const dz = at[1] - towards[1];
            const length = Math.hypot(dx, dz) || 1;
            const nx = (-dz / length) * 7 * unit;
            const nz = (dx / length) * 7 * unit;
            return (
              <g key={`end:${i}`} opacity={dim(line)}>
                <path
                  d={pathOf([
                    [at[0] - nx, at[1] - nz],
                    [at[0] + nx, at[1] + nz],
                  ])}
                  stroke={CASING}
                  strokeWidth={6 * unit}
                  strokeLinecap="round"
                />
                <path
                  d={pathOf([
                    [at[0] - nx, at[1] - nz],
                    [at[0] + nx, at[1] + nz],
                  ])}
                  stroke={colourOf(line)}
                  strokeWidth={3.5 * unit}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {network.junctions.map((junction) => (
            <circle
              key={junction.id}
              cx={junction.at[0]}
              cy={junction.at[1]}
              r={3.5 * unit}
              fill={CASING}
              stroke="#f3efe4"
              strokeWidth={1.5 * unit}
              className="pointer-events-auto"
            >
              <title>{`Junction: ${junction.thrown ? "set to the branch" : "set straight on"}`}</title>
            </circle>
          ))}
          {network.stops.map((stop, i) => {
            const capital = stop.kind === "faction_capital";
            return (
              <g key={`stop:${i}`} opacity={dim(stop.line)} className="pointer-events-auto">
                <title>{`${stop.name}${capital ? " (faction capital)" : ""}\n${Math.round(stop.along).toLocaleString(
                  "en-GB"
                )} blocks along the track · settlement ${blocks(stop.distance)} away`}</title>
                <circle
                  cx={stop.at[0]}
                  cy={stop.at[1]}
                  r={(capital ? 7.5 : 6) * unit}
                  fill="#fff"
                  stroke={CASING}
                  strokeWidth={(capital ? 3 : 2.5) * unit}
                />
                {capital ? (
                  <circle cx={stop.at[0]} cy={stop.at[1]} r={3 * unit} fill={colourOf(stop.line)} />
                ) : null}
              </g>
            );
          })}
          {placed.map((spot) => {
            const anchor = anchors[Number(spot.key)];
            const stop = network.stops[Number(spot.key)];
            return (
              <g key={`label:${spot.key}`} opacity={dim(stop.line)}>
                {spot.leader ? (
                  <line
                    x1={spot.leader.x1 * unit}
                    y1={spot.leader.y1 * unit}
                    x2={spot.leader.x2 * unit}
                    y2={spot.leader.y2 * unit}
                    stroke="#f3efe4"
                    strokeWidth={1.25 * unit}
                  />
                ) : null}
                <text
                  x={spot.x * unit}
                  y={(spot.y + LABEL_BASELINE) * unit}
                  fontSize={LABEL_FONT_PX * unit}
                  fontWeight={600}
                  fill="#fff"
                  {...halo}
                >
                  {anchor.label}
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
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-[#10160f] bg-white" /> stop
          <span className="ml-2 inline-flex h-3 w-3 items-center justify-center rounded-full border-2 border-[#10160f] bg-white">
            <span className="h-1 w-1 rounded-full bg-[#e8473b]" />
          </span>{" "}
          faction capital
          <span className="ml-2 inline-block h-2 w-2 rotate-45 border border-[#10160f] bg-[#f3efe4]" /> settlement
          <span className="ml-2 inline-block h-2 w-2 rounded-full border border-[#f3efe4] bg-[#10160f]" /> junction
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-block h-[5px] w-5 border border-[#10160f]"
            style={{ background: `repeating-linear-gradient(90deg, ${HAZARD} 0 3px, #10160f 3px 6px)` }}
          />{" "}
          broken
          <span className="ml-2 inline-block w-5 border-t-[3px] border-dashed" style={{ borderColor: DAMAGED }} />{" "}
          damaged
          <span className="ml-2 inline-block h-3 w-[3px] bg-[var(--tfmc-cream)]" /> end of track
        </span>
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

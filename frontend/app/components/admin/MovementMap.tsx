"use client";

import { useEffect, useMemo, useState } from "react";

import MapViewport from "../map/MapViewport";
import TileLayer from "../map/TileLayer";
import { mapFallbackSize, type MapId } from "../map/types";
import { tileUrl, useTileManifest } from "../../hooks/useTileManifest";
import { useMapViewport } from "../../hooks/useMapViewport";
import { mapApiUrl } from "@/lib/map/api";
import {
  ACTION_LOGIN,
  ACTION_LOGOUT,
  ageColour,
  boundsOf,
  isJump,
  positionAt,
  type Stretch,
} from "../../../lib/admin/movement";

/** How many colour steps a player's trail fades through, old to new. */
const AGE_BANDS = 16;
/** Above this many rows the per-ping dots are left out; the line still shows every ping. */
const MAX_DOTS = 3000;
/** Smallest box the camera frames, in blocks, so one spot is not zoomed in to single pixels. */
const MIN_FRAME = 160;

export type MovementTrail = {
  key: string;
  label: string;
  stretches: Stretch[];
  /** A fixed colour (everyone view); otherwise the line fades from old to new. */
  colour?: string;
};

type Props = {
  mapId: MapId;
  /** The CoreProtect world this map shows; rows in other worlds are not drawn. */
  mapWorld: string;
  trails: MovementTrail[];
  since: number;
  until: number;
  /** The slider's moment: a marker shows where each trail was then. */
  cursor: number;
  /** A trail to draw over the others, with the rest dimmed. */
  highlight?: string | null;
  /** How long after their last row a player still counts as there (see `positionAt`). */
  hold: number;
  className?: string;
};

type Segment = { d: string; colour: string };

function pt(x: number, z: number): string {
  return `${x + 0.5} ${z + 0.5}`;
}

/** One path per colour band for the walked steps, and one for the jumps. */
function trailPaths(trail: MovementTrail, mapWorld: string, since: number, until: number) {
  const span = Math.max(1, until - since);
  const bands = new Map<string, string[]>();
  const jumps: string[] = [];
  for (const stretch of trail.stretches) {
    if (stretch.world !== mapWorld) continue;
    const s = stretch.samples;
    for (let i = 1; i < s.length; i += 1) {
      const a = s[i - 1];
      const b = s[i];
      const step = `M${pt(a.x, a.z)}L${pt(b.x, b.z)}`;
      if (isJump(a, b)) {
        jumps.push(step);
        continue;
      }
      const colour =
        trail.colour ?? ageColour(Math.floor((((a.time + b.time) / 2 - since) / span) * AGE_BANDS) / (AGE_BANDS - 1));
      const list = bands.get(colour) ?? [];
      list.push(step);
      bands.set(colour, list);
    }
  }
  const walked: Segment[] = [...bands].map(([colour, steps]) => ({ colour, d: steps.join("") }));
  return { walked, casing: walked.map((seg) => seg.d).join(""), jumps: jumps.join("") };
}

export default function MovementMap({
  mapId,
  mapWorld,
  trails,
  since,
  until,
  cursor,
  highlight = null,
  hold,
  className,
}: Props) {
  const tiles = useTileManifest(mapId, "base", true);
  const [mapSize, setMapSize] = useState({ w: mapFallbackSize(mapId), h: mapFallbackSize(mapId) });
  const manifest = tiles.manifest;
  useEffect(() => {
    if (manifest) setMapSize({ w: manifest.width, h: manifest.height });
  }, [manifest]);

  const viewport = useMapViewport({ mapSize, fitMode: "contain", dragPan: true, keyboard: false, restingZoom: true });
  const { displayScale, focusMapRect, resetViewport, zoomBy } = viewport;
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

  const paths = useMemo(
    () => trails.map((trail) => ({ trail, ...trailPaths(trail, mapWorld, since, until) })),
    [trails, mapWorld, since, until]
  );
  const bounds = useMemo(() => {
    const boxes = trails.map((t) => boundsOf(t.stretches, mapWorld)).filter((b) => b !== null);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x;
    const h = Math.max(...boxes.map((b) => b.y + b.h)) - y;
    const padW = Math.max(MIN_FRAME, w) - w;
    const padH = Math.max(MIN_FRAME, h) - h;
    return { x: x - padW / 2, y: y - padH / 2, w: w + padW, h: h + padH };
  }, [trails, mapWorld]);

  // Frame the trails whenever a new answer brings a different box.
  const boundsKey = bounds ? `${bounds.x},${bounds.y},${bounds.w},${bounds.h}` : "none";
  useEffect(() => {
    if (!ready) return;
    if (bounds) focusMapRect(bounds, { left: 24, right: 24, top: 24, bottom: 24 });
    else resetViewport({ animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, ready]);

  const dots = trails.reduce((n, t) => n + t.stretches.reduce((m, s) => m + s.samples.length, 0), 0) <= MAX_DOTS;
  const unit = displayScale > 0 ? 1 / displayScale : 1;

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
          {paths.map(({ trail, walked, casing, jumps }) => {
            const dim = highlight !== null && highlight !== trail.key;
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
                {walked.map((seg) => (
                  <path
                    key={seg.colour}
                    d={seg.d}
                    fill="none"
                    stroke={seg.colour}
                    strokeWidth={3 * unit}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {jumps ? (
                  <path
                    d={jumps}
                    fill="none"
                    stroke={trail.colour ?? "#e8e4d9"}
                    strokeOpacity={0.7}
                    strokeWidth={1.5 * unit}
                    strokeDasharray={`${6 * unit} ${5 * unit}`}
                  >
                    <title>Unobserved movement: too fast to have walked, perhaps a teleport</title>
                  </path>
                ) : null}
                {trail.stretches.map((stretch) =>
                  stretch.world === mapWorld
                    ? stretch.samples.map((s, i) => {
                        const edge = s.action === ACTION_LOGIN || s.action === ACTION_LOGOUT;
                        if (!edge && !dots) return null;
                        const fill =
                          s.action === ACTION_LOGIN ? "#7fd18b" : s.action === ACTION_LOGOUT ? "#e8796f" : trail.colour ?? ageColour((s.time - since) / Math.max(1, until - since));
                        return (
                          <circle
                            key={`${s.time}:${i}`}
                            cx={s.x + 0.5}
                            cy={s.z + 0.5}
                            r={(edge ? 5 : 2.5) * unit}
                            fill={fill}
                            stroke={edge ? "#1b241d" : "none"}
                            strokeWidth={1.5 * unit}
                            className="pointer-events-auto"
                          >
                            <title>
                              {`${trail.label} — ${new Date(s.time * 1000).toLocaleString()}${
                                s.action === ACTION_LOGIN ? " (logged in)" : s.action === ACTION_LOGOUT ? " (logged out)" : ""
                              }\n${s.x}, ${s.y}, ${s.z}`}
                            </title>
                          </circle>
                        );
                      })
                    : null
                )}
              </g>
            );
          })}
          {trails.map((trail) => {
            const at = positionAt(trail.stretches, cursor, hold);
            if (!at || at.world !== mapWorld) return null;
            const dim = highlight !== null && highlight !== trail.key;
            return (
              <g key={`cursor:${trail.key}`} opacity={dim ? 0.35 : 1}>
                <circle
                  cx={at.x + 0.5}
                  cy={at.z + 0.5}
                  r={8 * unit}
                  fill={trail.colour ?? "#f4c96b"}
                  fillOpacity={at.exact ? 1 : 0.7}
                  stroke="#fff"
                  strokeWidth={2.5 * unit}
                />
                {trails.length > 1 ? (
                  <text
                    x={at.x + 12 * unit}
                    y={at.z + 4 * unit}
                    fontSize={13 * unit}
                    fontWeight={600}
                    fill="#fff"
                    stroke="#1b241d"
                    strokeWidth={3 * unit}
                    paintOrder="stroke"
                  >
                    {trail.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </MapViewport>
      <div className="absolute right-3 top-3 z-20 flex flex-col gap-1">
        {[
          { label: "+", title: "Zoom in", run: () => zoomBy(1.6) },
          { label: "−", title: "Zoom out", run: () => zoomBy(1 / 1.6) },
          {
            label: "⤢",
            title: "Fit the path",
            run: () => (bounds ? focusMapRect(bounds, { left: 24, right: 24, top: 24, bottom: 24 }) : resetViewport({ animated: true })),
          },
        ].map((button) => (
          <button
            key={button.title}
            type="button"
            title={button.title}
            aria-label={button.title}
            onClick={button.run}
            className="h-8 w-8 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_85%,transparent)] text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)]"
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

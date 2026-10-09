"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import MapViewport from "../map/MapViewport";
import { useMapViewport } from "../../hooks/useMapViewport";
import { formatMoment } from "../../../lib/admin/movement";
import type { RailLine, RailNetwork } from "../../../lib/admin/rail";
import { buildSchematic, projectBounds, roundedPath, GRID, type Pt } from "../../../lib/admin/railSchematic";
import type { RailFocus } from "./RailMap";

/** The Underground's own colours, in the order the terrain map's lines use (red, green, blue, ...). */
const TUBE_COLOURS = ["#DC241F", "#00782A", "#0098D4", "#FFD300", "#9B0056", "#EF7B10", "#00A4A7"];
const UNNAMED = "#A0A5A9";
/** Names, the key and its frame: the map's own blue. */
const TUBE_BLUE = "#0019A8";
const INK = "#000000";
/** Line width, in diagram units. */
const LW = 8;
const TICK = LW / 2 + 6;
const FONT = 15;
/** Names longer than this go on two lines, as on the printed map. */
const WRAP_AT = 15;
const FONT_FAMILY = 'var(--font-underground), "Johnston", "Gill Sans", "Gill Sans MT", Calibri, sans-serif';
const FOCUS_INSET = { left: 24, right: 24, top: 24, bottom: 24 };
const FRAMING = { fill: 0.9, maxUserScale: 6 };

export function tubeColour(line: RailLine | undefined): string {
  if (!line || line.name === "Unnamed line") return UNNAMED;
  return TUBE_COLOURS[line.id % TUBE_COLOURS.length];
}

/** A long name split at the space nearest its middle. */
export function wrapName(name: string): string[] {
  if (name.length <= WRAP_AT || !name.includes(" ")) return [name];
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " " && (best < 0 || Math.abs(i - name.length / 2) < Math.abs(best - name.length / 2))) best = i;
  }
  return [name.slice(0, best), name.slice(best + 1)];
}

type Props = {
  network: RailNetwork;
  highlight?: number | null;
  focus?: RailFocus | null;
  className?: string;
};

/** The network as an Underground map: straight lines at 45-degree steps, ticks for stops, rings for capitals. */
export default function RailTubeMap({ network, highlight = null, focus = null, className }: Props) {
  const schematic = useMemo(() => buildSchematic(network), [network]);
  const mapSize = useMemo(() => ({ w: schematic.width, h: schematic.height }), [schematic]);
  const viewport = useMapViewport({
    mapSize,
    fitMode: "contain",
    dragPan: true,
    keyboard: false,
    restingZoom: true,
    maxDisplayScale: 12,
  });
  const { focusMapRect, zoomBy } = viewport;
  const ready = viewport.viewportSize.w > 0;

  const lines = useMemo(() => new Map(network.lines.map((l) => [l.id, l])), [network.lines]);
  const colourOf = (line: number) => tubeColour(lines.get(line));
  const dim = (line: number) => (highlight !== null && highlight !== line ? 0.25 : 1);

  // The lines and their names, framed once the view has a size.
  const fit = useMemo(() => {
    const points = schematic.tracks.flatMap((t) => t.path);
    if (!points.length) return { x: 0, y: 0, w: schematic.width, h: schematic.height };
    const pad = GRID * 3;
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.max(0, Math.min(...xs) - pad);
    const y = Math.max(0, Math.min(...ys) - pad);
    return {
      x,
      y,
      w: Math.min(schematic.width, Math.max(...xs) + pad) - x,
      h: Math.min(schematic.height, Math.max(...ys) + pad) - y,
    };
  }, [schematic]);
  const fitNetwork = (animated = true) => focusMapRect(fit, FOCUS_INSET, FRAMING, { animated });

  // The whole network first, then whatever is picked from the list.
  const framedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const key = focus?.key ?? "network";
    if (framedRef.current === key) return;
    const first = framedRef.current === null;
    framedRef.current = key;
    if (focus) focusMapRect(projectBounds(schematic, focus.bounds), FOCUS_INSET, FRAMING, { animated: !first });
    else fitNetwork(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focus?.key]);

  const controls = [
    { label: "+", title: "Zoom in", run: () => zoomBy(1.6) },
    { label: "−", title: "Zoom out", run: () => zoomBy(1 / 1.6) },
    { label: "⤢", title: "Fit the network", run: () => fitNetwork() },
  ];

  return (
    <div className={`relative overflow-hidden bg-white ${className ?? ""}`} style={{ fontFamily: FONT_FAMILY }}>
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
        <svg
          className="pointer-events-none absolute left-0 top-0 h-full w-full"
          viewBox={`0 0 ${schematic.width} ${schematic.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Rail network as an Underground map"
          // Names keep their spacing at every zoom (see MapViewport's `unzoomed`).
          textRendering="geometricPrecision"
        >
          <rect width={schematic.width} height={schematic.height} fill="#fff" />
          {schematic.tracks.map((track) => (
            <path
              key={track.id}
              d={roundedPath(track.path, GRID * 0.6)}
              fill="none"
              stroke={colourOf(track.line)}
              strokeWidth={LW}
              strokeLinejoin="round"
              opacity={dim(track.line)}
            />
          ))}
          {schematic.stretches.map((s, i) => {
            const d = roundedPath(s.path, GRID * 0.6);
            const start = s.path[0];
            return (
              <g key={`stretch:${i}`} opacity={dim(s.line)} className="pointer-events-auto">
                <title>{s.kind === "broken" ? "Broken track" : "Damaged track"}</title>
                {s.kind === "broken" ? (
                  <>
                    <path d={d} fill="none" stroke="#fff" strokeWidth={LW + 1} />
                    <path d={d} fill="none" stroke={INK} strokeWidth={LW * 0.7} strokeDasharray="4 3" />
                  </>
                ) : (
                  <path d={d} fill="none" stroke="#fff" strokeWidth={LW * 0.4} />
                )}
                {/* A ring keeps a stretch of a few blocks visible. */}
                <circle
                  cx={start[0]}
                  cy={start[1]}
                  r={LW * 1.6}
                  fill="none"
                  stroke={s.kind === "broken" ? INK : "#F2A900"}
                  strokeWidth={2}
                  strokeDasharray={s.kind === "broken" ? "3 2" : undefined}
                />
              </g>
            );
          })}
          {schematic.ends.map((end, i) => (
            <Bar key={`end:${i}`} at={end.at} along={end.along} colour={colourOf(end.line)} opacity={dim(end.line)} />
          ))}
          {schematic.stops.map((spot) => {
            const stop = network.stops[spot.index];
            const capital = stop.kind === "faction_capital";
            const colour = colourOf(stop.line);
            const [x, y] = spot.at;
            const [sx, sy] = spot.side;
            return (
              <g key={`stop:${spot.index}`} opacity={dim(stop.line)} className="pointer-events-auto">
                <title>{`${stop.name}${capital ? " (faction capital)" : ""}`}</title>
                {spot.terminus && !capital ? <Bar at={spot.at} along={spot.along} colour={colour} /> : null}
                {capital ? (
                  <circle cx={x} cy={y} r={LW * 0.95} fill="#fff" stroke={INK} strokeWidth={LW * 0.42} />
                ) : spot.terminus ? null : (
                  <line x1={x} y1={y} x2={x + sx * TICK} y2={y + sy * TICK} stroke={colour} strokeWidth={LW * 0.7} />
                )}
                <Name name={stop.name} at={spot.at} side={spot.side} reach={capital ? LW * 1.4 + 3 : TICK + 3} />
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
            className="h-11 w-11 rounded-sm border-2 bg-white text-lg font-semibold"
            style={{ borderColor: TUBE_BLUE, color: TUBE_BLUE }}
          >
            {button.label}
          </button>
        ))}
      </div>
      <TubeKey network={network} colourOf={colourOf} />
    </div>
  );
}

/** A bar across the line: the end of the track. */
function Bar({ at, along, colour, opacity = 1 }: { at: Pt; along: Pt; colour: string; opacity?: number }) {
  const [nx, ny] = [-along[1] * TICK, along[0] * TICK];
  return (
    <line
      x1={at[0] - nx}
      y1={at[1] - ny}
      x2={at[0] + nx}
      y2={at[1] + ny}
      stroke={colour}
      strokeWidth={LW * 0.8}
      opacity={opacity}
    />
  );
}

/** A stop's name beyond its tick, on the side the tick points to. */
function Name({ name, at, side, reach }: { name: string; at: Pt; side: Pt; reach: number }) {
  const rows = wrapName(name);
  const [sx, sy] = side;
  const x = at[0] + sx * reach;
  const y = at[1] + sy * reach;
  const anchor = sx > 0.3 ? "start" : sx < -0.3 ? "end" : "middle";
  const lead = FONT * 1.05;
  // Beside the line the block of rows is centred on the tick; above or below it grows away from the line.
  const top =
    anchor !== "middle" ? y - ((rows.length - 1) * lead) / 2 + FONT * 0.35 : sy < 0 ? y - (rows.length - 1) * lead : y + FONT * 0.8;
  return (
    <text
      x={x}
      y={top}
      textAnchor={anchor}
      fontSize={FONT}
      fill={TUBE_BLUE}
      stroke="#fff"
      strokeWidth={3}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {rows.map((row, i) => (
        <tspan key={i} x={x} dy={i ? lead : 0}>
          {row}
        </tspan>
      ))}
    </text>
  );
}

/** The printed map's key: each line's name on a band of its colour, then the symbols. */
function TubeKey({ network, colourOf }: { network: RailNetwork; colourOf: (line: number) => string }) {
  const symbol = "inline-flex h-4 w-7 shrink-0 items-center justify-center";
  // Open where there is room for it beside the lines; on a phone it would cover them.
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(window.innerWidth >= 640), []);
  return (
    <div
      className="absolute bottom-2 left-2 z-20 w-60 max-w-[calc(100%-1rem)] overflow-hidden rounded-sm border-2 bg-white text-xs leading-tight"
      style={{ borderColor: TUBE_BLUE, color: TUBE_BLUE }}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-8 w-full items-center gap-2 px-2 py-1 text-left text-xs text-white"
        style={{ background: TUBE_BLUE }}
      >
        <Roundel />
        Key to lines
        <span className="ml-auto" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? <KeyBody network={network} colourOf={colourOf} symbol={symbol} /> : null}
    </div>
  );
}

function KeyBody({
  network,
  colourOf,
  symbol,
}: {
  network: RailNetwork;
  colourOf: (line: number) => string;
  symbol: string;
}) {
  return (
    <>
      <ul className="flex flex-col gap-0.5 px-1.5 pt-1.5">
        {network.lines.map((line) => {
          const colour = colourOf(line.id);
          return (
            <li
              key={line.id}
              className="truncate px-1.5 py-0.5"
              style={{ background: colour, color: colour === "#FFD300" || colour === UNNAMED ? TUBE_BLUE : "#fff" }}
            >
              {line.name}
            </li>
          );
        })}
      </ul>
      <ul className="grid grid-cols-2 gap-x-2 gap-y-1 px-2 py-1.5">
        <li className="flex items-center gap-1">
          <svg className={symbol} viewBox="0 0 28 16" aria-hidden>
            <line x1="0" y1="10" x2="28" y2="10" stroke={INK} strokeWidth="5" />
            <line x1="14" y1="10" x2="14" y2="3" stroke={INK} strokeWidth="3.5" />
          </svg>
          Stop
        </li>
        <li className="flex items-center gap-1">
          <svg className={symbol} viewBox="0 0 28 16" aria-hidden>
            <line x1="0" y1="8" x2="28" y2="8" stroke={INK} strokeWidth="5" />
            <circle cx="14" cy="8" r="5" fill="#fff" stroke={INK} strokeWidth="2.2" />
          </svg>
          Faction capital
        </li>
        <li className="flex items-center gap-1">
          <svg className={symbol} viewBox="0 0 28 16" aria-hidden>
            <line x1="0" y1="8" x2="20" y2="8" stroke={INK} strokeWidth="5" />
            <line x1="20" y1="2" x2="20" y2="14" stroke={INK} strokeWidth="4" />
          </svg>
          End of track
        </li>
        <li className="flex items-center gap-1">
          <svg className={symbol} viewBox="0 0 28 16" aria-hidden>
            <line x1="0" y1="8" x2="28" y2="8" stroke={INK} strokeWidth="5" />
            <line x1="0" y1="8" x2="28" y2="8" stroke="#fff" strokeWidth="2" />
          </svg>
          Damaged
        </li>
        <li className="flex items-center gap-1">
          <svg className={symbol} viewBox="0 0 28 16" aria-hidden>
            <line x1="0" y1="8" x2="28" y2="8" stroke={INK} strokeWidth="5" strokeDasharray="4 3" />
          </svg>
          Broken
        </li>
      </ul>
      {network.updated_at ? (
        <div className="px-2 py-1 text-[10px] text-white" style={{ background: TUBE_BLUE }}>
          Correct at {formatMoment(network.updated_at)}
        </div>
      ) : null}
    </>
  );
}

function Roundel() {
  return (
    <svg viewBox="0 0 24 16" className="h-4 w-6 shrink-0" aria-hidden>
      <circle cx="12" cy="8" r="6" fill="none" stroke="#DC241F" strokeWidth="3" />
      <rect x="2" y="6.3" width="20" height="3.4" fill="#fff" />
    </svg>
  );
}

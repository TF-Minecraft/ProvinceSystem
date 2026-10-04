import { memo } from "react";

import type { TradeEdgeStroke } from "../../lib/tradeEdges";

type TradeEdgeLayerProps = {
  strokes: TradeEdgeStroke[];
  mapW: number;
  mapH: number;
};

/**
 * Province-path trade routes. Rendered immediately before the hub-link layer
 * and one step under it, so a guild's own links stay on top. Pointer events
 * stay off: the map's hover overlay owns the pointer, and hit testing uses
 * the grid built with these strokes.
 */
export default memo(TradeEdgeLayer);

function TradeEdgeLayer({ strokes, mapW, mapH }: TradeEdgeLayerProps) {
  if (!strokes.length || !mapW || !mapH) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[12] h-full w-full"
      viewBox={`0 0 ${mapW} ${mapH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {strokes.map((stroke) => (
        <path
          key={stroke.key}
          d={stroke.d}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeDasharray={stroke.dash}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={stroke.opacity}
        />
      ))}
    </svg>
  );
}

import { memo, useMemo } from "react";

import type { HubLink } from "./types";
import { supplyLinkPaths } from "../../lib/supplyLinks";

type SupplyLinkLayerProps = {
  links: HubLink[];
  mapW: number;
  mapH: number;
};

export default memo(SupplyLinkLayer);

function SupplyLinkLayer({ links, mapW, mapH }: SupplyLinkLayerProps) {
  const paths = useMemo(() => supplyLinkPaths(links), [links]);
  if (!paths.length || !mapW || !mapH) return null;

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[13] h-full w-full"
      viewBox={`0 0 ${mapW} ${mapH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {paths.map((path) => (
        <line
          key={path.key}
          x1={path.fromX}
          y1={path.fromY}
          x2={path.toX}
          y2={path.toY}
          fill="none"
          stroke="#b6e3f5"
          strokeWidth={9}
          strokeDasharray={path.mode === "sea" ? "20 13" : path.mode === "air" ? "2 14" : undefined}
          strokeLinecap={path.mode === "air" ? "round" : "round"}
          opacity={0.92}
          style={{ filter: "drop-shadow(0 1px 3px #17242dcc)" }}
        />
      ))}
    </svg>
  );
}

import { memo, useMemo } from "react";

import type { WarExport } from "./types";
import type { ProvinceCentroids } from "../../lib/mapLabels";
import { buildWarCampaignPathPair, warLineStrokeStyle } from "../../lib/warCampaignLine";

type WarCampaignLineLayerProps = {
  wars: WarExport[];
  centroids?: ProvinceCentroids | null;
  mapW: number;
  mapH: number;
};

type PathStroke = {
  key: string;
  pathD: string;
  style: ReturnType<typeof warLineStrokeStyle>;
};

export default memo(WarCampaignLineLayer);

function WarCampaignLineLayer({ wars, centroids = null, mapW, mapH }: WarCampaignLineLayerProps) {
  const strokes = useMemo(() => {
    const rendered: PathStroke[] = [];
    for (const war of wars) {
      const pair = buildWarCampaignPathPair(war, centroids);
      if (pair.remainingD) {
        rendered.push({
          key: `${war.id}-remaining`,
          pathD: pair.remainingD,
          style: warLineStrokeStyle("remaining"),
        });
      }
      if (pair.progressedD) {
        rendered.push({
          key: `${war.id}-progressed`,
          pathD: pair.progressedD,
          style: warLineStrokeStyle("progressed"),
        });
      }
    }
    return rendered;
  }, [wars, centroids]);

  if (!strokes.length || !mapW || !mapH) {
    return null;
  }

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[13] h-full w-full"
      viewBox={`0 0 ${mapW} ${mapH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {strokes.map((stroke) => (
        <path
          key={stroke.key}
          d={stroke.pathD}
          fill="none"
          stroke={stroke.style.dashColor}
          strokeWidth={stroke.style.dashWidth}
          strokeDasharray={stroke.style.dashArray}
          strokeLinecap="butt"
          strokeLinejoin="round"
          opacity={stroke.style.opacity}
        />
      ))}
    </svg>
  );
}

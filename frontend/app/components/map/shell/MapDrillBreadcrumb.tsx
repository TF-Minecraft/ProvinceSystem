import { Fragment } from "react";

import { cleanRegionName } from "@/app/lib/mapLabels";

import type { DrillLayer } from "../drillUtils";
import { ChevronIcon, CloseIcon } from "./MapIcons";

type MapDrillBreadcrumbProps = {
  rootLabel: string;
  drillStack: DrillLayer[];
  onSelectLayer: (index: number) => void;
  onReset: () => void;
};

/**
 * Where the map is drilled to, as a trail: the mode, then each realm whose
 * subjects are open. Any step goes back to that level; the cross closes them
 * all.
 */
export default function MapDrillBreadcrumb({
  rootLabel,
  drillStack,
  onSelectLayer,
  onReset,
}: MapDrillBreadcrumbProps) {
  if (drillStack.length === 0) return null;

  return (
    <nav
      aria-label="Open subject layers"
      className="map-frame flex items-center gap-1 overflow-x-auto py-1 pl-2 pr-1 text-sm [scrollbar-width:none]"
    >
      <button
        type="button"
        onClick={onReset}
        className="shrink-0 rounded px-1.5 py-1 text-[var(--tfmc-stone)] hover:text-[var(--tfmc-parchment)]"
      >
        {rootLabel}
      </button>
      {drillStack.map((layer, index) => {
        const current = index === drillStack.length - 1;
        return (
          <Fragment key={layer.regionId}>
            <ChevronIcon size={14} className="shrink-0 text-[var(--tfmc-gilt-dim)]" />
            <button
              type="button"
              onClick={() => onSelectLayer(index)}
              aria-current={current ? "location" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded px-1.5 py-1 ${
                current
                  ? "text-[var(--tfmc-parchment)]"
                  : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-parchment)]"
              }`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-sm ring-1 ring-black/60"
                style={{ backgroundColor: `rgb(${layer.rgb})` }}
              />
              {cleanRegionName(layer.name) || layer.regionId}
            </button>
          </Fragment>
        );
      })}
      <button
        type="button"
        onClick={onReset}
        aria-label="Close all subject layers"
        title="Back to the whole map"
        className="map-control ml-1 h-7 w-7 shrink-0"
      >
        <CloseIcon size={14} />
      </button>
    </nav>
  );
}

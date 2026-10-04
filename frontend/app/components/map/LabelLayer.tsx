import { memo } from "react";
import {
  LABEL_INK,
  LABEL_FONT_WEIGHT,
  shouldShowLabelAtScreenSize,
  type NationLabelSpec,
} from "../../lib/mapLabels";
import { HOVER_OVERLAY_EXPAND } from "./overlayStyle";

const LABEL_HOVER_SCALE = 1 + HOVER_OVERLAY_EXPAND;
const LABEL_HOVER_TRANSITION = "transform 150ms ease-out";
const LABEL_VISIBILITY_TRANSITION = "opacity 200ms ease-out";

type LabelLayerProps = {
  labels: NationLabelSpec[];
  mapW: number;
  mapH: number;
  displayScale: number;
  hoveredNationId?: string | null;
  /**
   * Skips the zoom-size gate and draws every entry at full opacity.
   *
   * For the timelapse studio, where every layer on screen is one the user
   * ticked on: a layer that hides itself at the zoom they are viewing at is
   * simply the layer they asked for not being there. The live map passes
   * nothing — it has no layer toggles, so the gate is the only thing keeping
   * several hundred chips off a world-zoom view, and its hover picking filters
   * on the same predicate.
   */
  alwaysVisible?: boolean;
};

export default memo(LabelLayer);

function LabelLayer({
  labels,
  mapW,
  mapH,
  displayScale,
  hoveredNationId = null,
  alwaysVisible = false,
}: LabelLayerProps) {
  if (!labels.length || !mapW || !mapH || displayScale <= 0) {
    return null;
  }

  return (
    <svg
      className="pointer-events-none absolute left-0 top-0 z-[15] h-full w-full"
      viewBox={`0 0 ${mapW} ${mapH}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      {labels.map((label) => {
        const pathId = `map-label-${label.nationId}-${label.componentIndex}`;
        const hovered = hoveredNationId === label.nationId;
        const visible =
          alwaysVisible ||
          shouldShowLabelAtScreenSize(label.fontSize, displayScale);
        const hoverTransform = hovered
          ? `translate(${label.cx} ${label.cy}) scale(${LABEL_HOVER_SCALE}) translate(${-label.cx} ${-label.cy})`
          : undefined;

        return (
          <g
            key={`${label.nationId}:${label.componentIndex}`}
            style={{
              pointerEvents: "none",
              opacity: visible ? 1 : 0,
              transform: hoverTransform,
              transformOrigin: `${label.cx}px ${label.cy}px`,
              transition: `${LABEL_VISIBILITY_TRANSITION}, ${LABEL_HOVER_TRANSITION}`,
            }}
          >
            <g
              transform={`translate(${label.pathOffsetX} ${label.pathOffsetY})`}
            >
              <path id={pathId} d={label.pathD} fill="none" />
              <text
                fontSize={label.fontSize}
                fill={LABEL_INK}
                style={{
                  fontFamily: "var(--font-fraunces), serif",
                  fontWeight: LABEL_FONT_WEIGHT,
                  // Otherwise the browser re-shapes every name at its new
                  // size on screen each time the zoom changes, a few tens of
                  // ms per step. The cost is unhinted outlines, which only
                  // tell at the smallest sizes a name is shown at.
                  textRendering: "geometricPrecision",
                }}
              >
                <textPath
                  href={`#${pathId}`}
                  startOffset="50%"
                  textAnchor="middle"
                >
                  {label.text}
                </textPath>
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

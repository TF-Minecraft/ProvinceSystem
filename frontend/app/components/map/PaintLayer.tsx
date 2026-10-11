"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import { PAINT_HANDLE_SCREEN_PX, paintShapeRotation, paintSizesMapPx, type PaintShape } from "../../lib/mapPaint";
import { boundsCentre, paintBoundsCorners, paintShapeBounds } from "../../lib/mapPaintGeometry";
import { paintRotationKnob } from "../../hooks/useMapPaint";
import PaintShapeView from "./PaintShapeView";

export type PaintLayerHandlers = {
  onPointerDown: (event: ReactPointerEvent<Element>) => void;
  onPointerMove: (event: ReactPointerEvent<Element>) => void;
  onPointerUp: (event: ReactPointerEvent<Element>) => void;
  onPointerCancel: (event: ReactPointerEvent<Element>) => void;
};

type PaintLayerProps = {
  enabled: boolean;
  visible: boolean;
  shapes: PaintShape[];
  draft: PaintShape | null;
  selectedId: string | null;
  handlers: PaintLayerHandlers;
  mapW: number;
  mapH: number;
  /**
   * Only used to keep the selection box and its corner handles a constant
   * on-screen size. Painted content itself is fixed in map pixels and scales
   * with the map.
   */
  displayScale: number;
  /** Tailwind cursor class applied while paint mode is on. */
  cursorClassName?: string;
};

const SELECTION_STROKE = "#d4c9ae";

/**
 * The war-planning annotation layer, drawn in map-pixel user space so it pans
 * and zooms with the map for free (the parent div is already CSS-transformed).
 *
 * When paint mode is off this is `pointer-events: none`, so every event falls
 * straight through to the pick canvas underneath and the map behaves exactly as
 * it did before paint mode existed. When on, a transparent full-bleed rect
 * captures left-drags — but the handlers ignore every other button and never
 * stop propagation, so middle-click panning and wheel zoom (bound higher up by
 * useMapViewport) are unaffected.
 */
export default function PaintLayer({
  enabled,
  visible,
  shapes,
  draft,
  selectedId,
  handlers,
  mapW,
  mapH,
  displayScale,
  cursorClassName = "",
}: PaintLayerProps) {
  if (!mapW || !mapH) return null;

  const selected = selectedId ? (shapes.find((shape) => shape.id === selectedId) ?? null) : null;
  const bounds = selected ? paintShapeBounds(selected, paintSizesMapPx()) : null;
  const chromePx = (screenPx: number) => (displayScale > 0 ? screenPx / displayScale : screenPx);
  const handleSize = chromePx(PAINT_HANDLE_SCREEN_PX);

  return (
    <svg
      className={`absolute left-0 top-0 z-[21] h-full w-full ${enabled ? cursorClassName : ""}`}
      style={{ pointerEvents: enabled ? "auto" : "none", touchAction: "none" }}
      viewBox={`0 0 ${mapW} ${mapH}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={handlers.onPointerDown}
      onPointerMove={handlers.onPointerMove}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      {enabled ? <rect x={0} y={0} width={mapW} height={mapH} fill="transparent" pointerEvents="all" /> : null}

      {visible ? (
        <g pointerEvents="none">
          {shapes.map((shape) => (
            <PaintShapeView key={shape.id} shape={shape} selected={shape.id === selectedId} />
          ))}
          {draft ? <PaintShapeView shape={draft} /> : null}
        </g>
      ) : null}

      {/* Selection chrome: box, corner grips and the rotation knob. Drawn in the
          shape's own frame and rotated as a unit, so the grips stay on the
          corners they actually resize. Hit-testing lives in useMapPaint, so
          these are purely visual. */}
      {enabled && visible && bounds && selected
        ? (() => {
            const rotation = paintShapeRotation(selected);
            const centre = boundsCentre(bounds);
            const knob = paintRotationKnob(bounds, handleSize);
            return (
              <g pointerEvents="none" transform={rotation ? `rotate(${rotation} ${centre.x} ${centre.y})` : undefined}>
                <rect
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.w}
                  height={bounds.h}
                  fill="none"
                  stroke={SELECTION_STROKE}
                  strokeOpacity={0.9}
                  strokeWidth={chromePx(1)}
                  strokeDasharray={`${chromePx(4)} ${chromePx(3)}`}
                />
                <line
                  x1={centre.x}
                  y1={bounds.y}
                  x2={knob.x}
                  y2={knob.y}
                  stroke={SELECTION_STROKE}
                  strokeOpacity={0.9}
                  strokeWidth={chromePx(1)}
                />
                <circle
                  cx={knob.x}
                  cy={knob.y}
                  r={handleSize / 2}
                  fill={SELECTION_STROKE}
                  stroke="#0a1512"
                  strokeWidth={chromePx(1)}
                />
                {paintBoundsCorners(bounds).map((corner, index) => (
                  <rect
                    key={index}
                    x={corner.x - handleSize / 2}
                    y={corner.y - handleSize / 2}
                    width={handleSize}
                    height={handleSize}
                    rx={chromePx(1.5)}
                    fill={SELECTION_STROKE}
                    stroke="#0a1512"
                    strokeWidth={chromePx(1)}
                  />
                ))}
              </g>
            );
          })()
        : null}
    </svg>
  );
}

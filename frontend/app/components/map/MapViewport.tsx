import type { CSSProperties, ReactNode, RefObject } from "react";

import type { Size } from "../../lib/mapViewportMath";

export type MapViewportProps = {
  mapSize: Size;
  viewportRef: RefObject<HTMLDivElement | null>;
  /** The scaled layer; `useMapViewport` moves it directly during gestures. */
  contentRef?: RefObject<HTMLDivElement | null>;
  transformStyle: string;
  transformTransition?: string;
  /**
   * CSS `zoom` on the map content, the resting scale `useMapViewport` keeps
   * out of the transform (see its `restingZoom`). 1 by default.
   */
  zoom?: number;
  cursorClassName: string;
  isPanning: boolean;
  children: ReactNode;
  /**
   * Content laid out at the map's full size and scaled by a transform instead
   * of `zoom`, above `children` at z-index `unzoomedZIndex`.
   *
   * For the realm names. SVG text is laid out again whenever its scale on
   * screen changes, and under `zoom` every settled zoom step is such a change
   * (a few tens of ms per step for the names alone). With
   * `text-rendering: geometricPrecision` a transform's scale is not, so here
   * zooming only repaints them. Not for WebKit (see `unzoomedLabelsSupported`).
   */
  unzoomed?: ReactNode;
  unzoomedZIndex?: number;
  /**
   * Full-bleed mode: the container takes its size from CSS layout (flex/grid
   * `h-full`) instead of a square `aspect-ratio` locked to the map's own
   * dimensions. Use this when the map fills an arbitrary rectangle of the
   * screen; `computeFitScale`'s "contain" fit then picks the scale that shows
   * the whole map inside whatever rectangle results.
   */
  fill?: boolean;
  /**
   * The viewport handles touch itself (one-finger pan, pinch zoom), so the
   * browser must not scroll or zoom the page underneath it.
   */
  capturesTouch?: boolean;
};

export default function MapViewport({
  mapSize,
  viewportRef,
  contentRef,
  transformStyle,
  transformTransition,
  zoom = 1,
  cursorClassName,
  isPanning,
  children,
  unzoomed,
  unzoomedZIndex,
  fill = false,
  capturesTouch = false,
}: MapViewportProps) {
  const { w: mapW, h: mapH } = mapSize;

  const outerStyle: CSSProperties | undefined =
    !fill && mapW > 0 && mapH > 0
      ? { aspectRatio: `${mapW} / ${mapH}` }
      : undefined;

  // The transform moves (and, mid-gesture, scales) the zoomed content; the
  // map itself is laid out at its size on screen.
  const innerStyle: CSSProperties = {
    width: mapW * zoom,
    height: mapH * zoom,
    transform: transformStyle,
    transformOrigin: "0 0",
    transition: transformTransition,
  };
  // iOS text autosizing resets an element's font size to the size it
  // specified, dropping `zoom`: settlement names drew at their full map-pixel
  // size (48-72 px on screen) over a map zoomed out to a tenth. `none` is the
  // one value that turns the adjustment off (Tailwind's base sets 100%).
  const zoomedStyle: CSSProperties = {
    width: mapW,
    height: mapH,
    zoom,
    WebkitTextSizeAdjust: "none",
    textSizeAdjust: "none",
  };

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-hidden ${fill ? "h-full w-full" : "w-full"} ${cursorClassName}${
        isPanning || capturesTouch ? " select-none" : ""
      }${capturesTouch ? " touch-none" : ""}`}
      style={outerStyle}
    >
      <div ref={contentRef} className="relative" style={innerStyle}>
        <div className="relative" style={zoomedStyle}>
          {children}
        </div>
        {unzoomed ? (
          <div
            className="pointer-events-none absolute left-0 top-0"
            style={{
              width: mapW,
              height: mapH,
              transform: `scale(${zoom})`,
              transformOrigin: "0 0",
              zIndex: unzoomedZIndex,
            }}
          >
            {unzoomed}
          </div>
        ) : null}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState, type ReactNode } from "react";

type MapShellProps = {
  /** The map itself. Rendered exactly once, at every breakpoint. */
  children: ReactNode;
  /** Title plaque and search, top left. */
  plaque: ReactNode;
  /** Drill-down breadcrumb, top centre; null when not drilled in. */
  breadcrumb?: ReactNode;
  /** A short note while a map mode loads; null when idle. */
  status?: string | null;
  /** The selected region's details; null when nothing is selected. */
  details?: ReactNode;
  /** Changes whenever a different region is selected, to reset the sheet. */
  detailsKey?: string | null;
  zoomControls: ReactNode;
  /** The layers button (map types and overlays), top right. */
  layers: ReactNode;
  /** War-planning toolbar, top right under the layers button while paint mode is on. */
  paintPanel?: ReactNode;
  /**
   * A stored chronicle day. Its date banner is fixed at the top centre of the
   * screen, so the top-row controls start below it wherever they would meet.
   */
  chronicle?: boolean;
};

/**
 * Full-bleed map with its controls floating over it, laid out like Google
 * Maps. Search and the details panel down the left, layers top right (the map
 * modes live in its panel), zoom bottom right.
 *
 * On a phone the same pieces regroup instead of shrinking: one slim search
 * row across the top with the breadcrumb and layers under it, details in a
 * bottom sheet, and no zoom buttons (pinch zooms). The map and the panels are
 * one node each, placed by responsive classes; only the small top-row
 * controls (breadcrumb, layers) have a phone and a desktop copy.
 */
export default function MapShell({
  children,
  plaque,
  breadcrumb,
  details,
  detailsKey,
  status,
  zoomControls,
  layers,
  paintPanel,
  chronicle = false,
}: MapShellProps) {
  const [sheetExpanded, setSheetExpanded] = useState(false);

  // A newly selected region opens the sheet at its peek height again.
  useEffect(() => {
    setSheetExpanded(false);
  }, [detailsKey]);

  // The map fills the screen below the header and nothing else is on the
  // page, so the page itself must not move: on an iPhone a drag on the panels
  // scrolled or rubber-banded it, sliding them under the header. Scrolling
  // inside the panels is unaffected.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("map-fullscreen");
    return () => root.classList.remove("map-fullscreen");
  }, []);

  const chronicleTop = chronicle ? "max-xl:top-[10.75rem]" : "";

  return (
    // pan-x pan-y: panels still scroll, but a pinch on them cannot zoom the
    // page (the map handles its own pinch).
    <div className="relative h-[calc(100dvh-var(--tfmc-header-h))] overflow-hidden bg-[radial-gradient(ellipse_at_center,#16231c_0%,#0a110d_70%)] text-[var(--tfmc-cream)] [touch-action:pan-x_pan-y]">
      <div className="absolute inset-0">{children}</div>

      {/* Left column: plaque on top, details under it on desktop; on mobile
          the details drop to a bottom sheet via `mt-auto`. The column itself
          lets clicks through to the map; only its panels take them. */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 flex flex-col gap-2 p-3 md:inset-auto md:bottom-4 md:left-4 md:top-4 md:w-[23rem] md:gap-3 md:p-0 ${chronicleTop} ${
          chronicle ? "max-md:pt-[10.75rem]" : ""
        }`}
      >
        {/* Above the details panel, so search results drop down over it. */}
        <div className="pointer-events-auto relative z-10 shrink-0">
          {plaque}
          {/* Breadcrumb left, layers right, as Google Maps' phone app puts
              its layers button under the search bar. The gap between them
              lets clicks through to the map. */}
          <div className="pointer-events-none mt-2 flex items-start gap-2 md:hidden">
            <div className="pointer-events-auto min-w-0 flex-1 empty:hidden">{breadcrumb}</div>
            <div className="pointer-events-auto ml-auto shrink-0">{layers}</div>
          </div>
        </div>

        {details ? (
          <div
            key={detailsKey ?? undefined}
            className={`map-frame map-details-enter pointer-events-auto -mx-3 -mb-3 mt-auto flex min-h-0 flex-col rounded-b-none md:mx-0 md:mb-0 md:mt-0 md:rounded-b-[10px] ${
              sheetExpanded ? "max-h-[82%]" : "max-h-[44%]"
            } md:max-h-full`}
          >
            <button
              type="button"
              onClick={() => setSheetExpanded((value) => !value)}
              aria-label={sheetExpanded ? "Show less" : "Show more"}
              aria-expanded={sheetExpanded}
              className="flex shrink-0 justify-center pb-1 pt-2 md:hidden"
            >
              <span className="h-1 w-10 rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" />
            </button>
            <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pt-1 md:pt-4">
              {details}
            </div>
          </div>
        ) : null}
      </div>

      {breadcrumb ? (
        <div
          className={`pointer-events-none absolute left-1/2 top-4 z-20 hidden max-w-[min(42rem,calc(100%-52rem))] -translate-x-1/2 md:block ${
            chronicle ? "top-[10.75rem]" : ""
          }`}
        >
          <div className="pointer-events-auto">{breadcrumb}</div>
        </div>
      ) : null}

      {/* Under the panels, so the layers sheet covers it while a mode loads. */}
      {status ? (
        <div
          role="status"
          className="map-frame pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 px-4 py-1.5 text-sm text-[var(--tfmc-cream)]"
        >
          {status}
        </div>
      ) : null}

      {paintPanel ? (
        <div
          className={`pointer-events-auto absolute right-4 top-[4.25rem] z-20 hidden max-h-[calc(100%-12.25rem)] w-72 overflow-y-auto md:block ${
            chronicle ? "max-xl:top-[14.25rem]" : ""
          }`}
        >
          {paintPanel}
        </div>
      ) : null}

      {/* Over the paint toolbar and zoom, so the layers panel drops down across them. */}
      <div className={`absolute right-4 top-4 z-40 hidden md:block ${chronicleTop}`}>
        {layers}
      </div>

      <div className="absolute bottom-4 right-4 z-30 hidden md:block">{zoomControls}</div>
    </div>
  );
}

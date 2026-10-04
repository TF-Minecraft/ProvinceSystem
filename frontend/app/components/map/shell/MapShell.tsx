"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { useBottomSheetDrag } from "@/app/hooks/useBottomSheetDrag";

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
  /** Clears the selection: the phone sheet was pulled down and closed. */
  onDetailsClose?: () => void;
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
  onDetailsClose,
  status,
  zoomControls,
  layers,
  paintPanel,
  chronicle = false,
}: MapShellProps) {
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
          the details are a bottom sheet pinned to the column's foot, which
          at full height rises over the search. The column itself lets clicks
          through to the map; only its panels take them. */}
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
            <div className="min-w-0 flex-1 empty:hidden">{breadcrumb}</div>
            <div className="pointer-events-auto ml-auto shrink-0">{layers}</div>
          </div>
        </div>

        {details ? (
          // Keyed, so a newly selected region opens at the peek height again.
          <DetailsSheet key={detailsKey ?? undefined} onClose={onDetailsClose}>
            {details}
          </DetailsSheet>
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

/** The strip of map a full-height phone sheet leaves above it (`0.75rem`). */
const FULL_SHEET_GAP_PX = 12;

/**
 * The selection's details: a side panel on desktop, and on a phone a bottom
 * sheet with Google Maps' two sizes. It opens at a peek height; dragging it
 * up (or tapping the handle) grows it to nearly the whole map, over the
 * search, and dragging down shrinks it again or, from the peek height,
 * closes it.
 */
function DetailsSheet({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useBottomSheetDrag(sheetRef, {
    onClose: () => onClose?.(),
    expanded,
    onExpandedChange: setExpanded,
    scrollerRef,
    fullHeight: () => (sheetRef.current?.parentElement?.clientHeight ?? 0) - FULL_SHEET_GAP_PX,
  });

  return (
    <div
      ref={sheetRef}
      className={`map-frame map-details-enter pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex max-md:bg-[var(--tfmc-forest-deep)] min-h-0 flex-col rounded-b-none md:static md:z-auto md:rounded-b-[10px] ${
        expanded ? "max-h-[calc(100%-0.75rem)]" : "max-h-[44%]"
      } max-md:transition-[max-height] max-md:duration-200 max-md:ease-out md:max-h-full`}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-label={expanded ? "Show less" : "Show more"}
        aria-expanded={expanded}
        className="flex shrink-0 justify-center pt-2 md:hidden"
      >
        <span className="h-1 w-10 rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" />
      </button>
      <div
        ref={scrollerRef}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pb-4"
      >
        {children}
      </div>
    </div>
  );
}

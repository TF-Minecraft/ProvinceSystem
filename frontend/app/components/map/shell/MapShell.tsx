"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { useBottomSheetDrag } from "@/app/hooks/useBottomSheetDrag";

import type { MapLayersPlacement } from "./MapLayersMenu";
import { ChevronIcon } from "./MapIcons";
import { mapFrameClass } from "../ui";

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
  /**
   * Pinned above the details' scrolling content, so the scrollbar starts
   * under it: the timelapse's steps.
   */
  detailsHeader?: ReactNode;
  /** Pinned under the details' scrolling content: the panel's main action. */
  detailsFooter?: ReactNode;
  zoomControls: ReactNode;
  /**
   * The layers control (map types and overlays), built for each place it
   * goes: a round button under the search on a phone, the picture tile in
   * the bottom-left corner on a desktop.
   */
  layers?: (placement: MapLayersPlacement) => ReactNode;
  /**
   * A bar along the foot of the map between the left column and the zoom
   * buttons, on desktop only: the timelapse's player.
   */
  footer?: ReactNode;
  /** A panel down the right-hand side, on desktop only: the timelapse's charts. */
  aside?: ReactNode;
  /** War-planning toolbar, top right while paint mode is on. */
  paintPanel?: ReactNode;
  /**
   * A card over the plaque, in the left column: a stored day's date and the
   * way to the days either side of it.
   */
  banner?: ReactNode;
};

/**
 * Full-bleed map with a full-height desktop selection drawer. Search stays
 * above its scrolling details; the edge handle hides the whole drawer while
 * retaining the selection. Layers sits beside the open drawer, zoom bottom right.
 *
 * On a phone the same pieces regroup instead of shrinking: one slim search
 * row across the top with the breadcrumb and layers under it, details in a
 * bottom sheet, and no zoom buttons (pinch zooms). The map and the panels are
 * one node each, placed by responsive classes; only the small controls
 * (breadcrumb, layers) have a phone and a desktop copy.
 */
export default function MapShell({
  children,
  plaque,
  breadcrumb,
  details,
  detailsKey,
  onDetailsClose,
  detailsHeader,
  detailsFooter,
  status,
  zoomControls,
  layers,
  footer,
  aside,
  paintPanel,
  banner,
}: MapShellProps) {
  const sidebarId = useId();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const hasDetails = Boolean(details);
  const selectionKey = hasDetails ? (detailsKey ?? "details") : null;
  const [desktopDrawer, setDesktopDrawer] = useState({ key: selectionKey, collapsed: false });
  if (desktopDrawer.key !== selectionKey) {
    setDesktopDrawer({ key: selectionKey, collapsed: false });
  }
  const collapsed = hasDetails && desktopDrawer.key === selectionKey && desktopDrawer.collapsed;
  const desktopDrawerOpen = hasDetails && !collapsed;

  // Desktop collapse must not hide the phone's search or bottom sheet.
  useEffect(() => {
    const desktop = window.matchMedia?.("(min-width: 48rem)");
    if (!desktop) return;
    function onChange(event: MediaQueryListEvent) {
      if (!event.matches) setDesktopDrawer((drawer) => ({ ...drawer, collapsed: false }));
    }
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  // Preserve the search shortcut even while its input is in the hidden drawer.
  useEffect(() => {
    if (!collapsed) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!sidebarRef.current?.querySelector("input[role=combobox]")) return;
      event.preventDefault();
      setDesktopDrawer((drawer) => ({ ...drawer, collapsed: false }));
      requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLInputElement>("input[role=combobox]")?.focus());
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed]);

  // The map fills the screen below the header and nothing else is on the
  // page, so the page itself must not move: on an iPhone a drag on the panels
  // scrolled or rubber-banded it, sliding them under the header. Scrolling
  // inside the panels is unaffected.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("map-fullscreen");
    return () => root.classList.remove("map-fullscreen");
  }, []);

  return (
    // pan-x pan-y: panels still scroll, but a pinch on them cannot zoom the
    // page (the map handles its own pinch).
    <div className="map-shell relative h-[calc(100dvh-var(--tfmc-header-h))] overflow-hidden bg-[radial-gradient(ellipse_at_center,#16231c_0%,#0a110d_70%)] text-[var(--tfmc-cream)] [touch-action:pan-x_pan-y]">
      <div className="absolute inset-0">{children}</div>

      {/* One search and one details node at every breakpoint. Only the
          desktop drawer moves away; on phones the details remain a sheet. */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 md:inset-y-0 md:left-0 md:right-auto md:w-[23rem] motion-safe:md:transition-transform motion-safe:md:duration-200 ${
          collapsed ? "md:-translate-x-full" : "md:translate-x-0"
        }`}
      >
        <div
          id={sidebarId}
          ref={sidebarRef}
          inert={collapsed}
          aria-hidden={collapsed || undefined}
          className={`relative flex h-full min-h-0 flex-col gap-2 p-3 md:gap-0 md:border-r md:p-0 ${
            hasDetails
              ? "md:border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] md:bg-[var(--tfmc-forest-deep)] md:shadow-[8px_0_24px_rgb(0_0_0/0.3)]"
              : "md:border-transparent"
          }`}
        >
          {/* Search never joins the details' scroller, and its results sit above it. */}
          <div
            className={`pointer-events-auto relative z-10 shrink-0 has-[[role=dialog]]:z-30 md:z-30 md:p-4 ${
              hasDetails ? "md:border-b md:border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]" : ""
            }`}
          >
            {banner ? <div className="mb-2 md:mb-3">{banner}</div> : null}
            {plaque}
            {breadcrumb || layers ? (
              <div className="pointer-events-none mt-2 flex items-start gap-2 md:hidden">
                <div className="min-w-0 flex-1 empty:hidden">{breadcrumb}</div>
                {layers ? <div className="pointer-events-auto ml-auto shrink-0">{layers("phone")}</div> : null}
              </div>
            ) : null}
          </div>

          {details ? (
            <DetailsSheet
              key={detailsKey ?? undefined}
              onClose={onDetailsClose}
              header={detailsHeader}
              footer={detailsFooter}
            >
              {details}
            </DetailsSheet>
          ) : null}
        </div>
        {hasDetails ? (
          <button
            type="button"
            aria-label={collapsed ? "Expand map panel" : "Collapse map panel"}
            aria-expanded={!collapsed}
            aria-controls={sidebarId}
            title={collapsed ? "Expand map panel" : "Collapse map panel"}
            onClick={() => setDesktopDrawer((drawer) => ({ ...drawer, collapsed: !drawer.collapsed }))}
            className="pointer-events-auto absolute left-full top-1/2 hidden h-12 w-7 -translate-y-1/2 items-center justify-center rounded-r-lg border border-l-0 border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[var(--tfmc-forest-deep)] text-[var(--tfmc-stone)] shadow-[4px_2px_10px_rgb(0_0_0/0.25)] hover:bg-[var(--tfmc-forest)] hover:text-[var(--tfmc-cream)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] md:flex"
          >
            <ChevronIcon size={18} className={collapsed ? "" : "rotate-180"} />
          </button>
        ) : null}
      </div>

      {breadcrumb ? (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 hidden max-w-[min(42rem,calc(100%-52rem))] -translate-x-1/2 md:block">
          <div className="pointer-events-auto">{breadcrumb}</div>
        </div>
      ) : null}

      {/* Under the panels, so the layers sheet covers it while a mode loads. */}
      {status ? (
        <div
          role="status"
          className={`${mapFrameClass} pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 px-4 py-1.5 text-sm text-[var(--tfmc-cream)]`}
        >
          {status}
        </div>
      ) : null}

      {paintPanel ? (
        <div className="pointer-events-auto absolute right-4 top-4 z-20 hidden max-h-[calc(100%-9rem)] w-72 overflow-y-auto md:block">
          {paintPanel}
        </div>
      ) : null}

      {/* Bottom left, moving aside for the open 23rem drawer. The choices unfold as
          far as the zoom buttons, wrapping upwards when it runs out of room. */}
      {layers ? (
        <div
          className={`pointer-events-none absolute bottom-4 right-[4.5rem] z-40 hidden md:flex ${
            desktopDrawerOpen ? "left-[24rem]" : "left-4"
          }`}
        >
          {layers("desktop")}
        </div>
      ) : null}

      {aside ? (
        <div className="pointer-events-auto absolute bottom-[9.5rem] right-4 top-4 z-20 hidden w-80 overflow-y-auto md:block">
          {aside}
        </div>
      ) : null}

      {footer ? (
        <div
          className={`pointer-events-none absolute bottom-4 right-[4.5rem] z-20 hidden justify-center md:flex ${
            desktopDrawerOpen ? "left-[24rem]" : "left-4"
          }`}
        >
          <div className="pointer-events-auto w-full max-w-3xl">{footer}</div>
        </div>
      ) : null}

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
  header,
  footer,
}: {
  children: ReactNode;
  onClose?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
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
      className={`${mapFrameClass} pointer-events-auto motion-safe:max-md:animate-map-sheet-in absolute inset-x-0 bottom-0 z-20 flex max-md:bg-[var(--tfmc-forest-deep)] min-h-0 flex-col rounded-b-none md:static md:z-auto md:flex-1 md:rounded-none md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none ${
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
      {header ? <div className="shrink-0">{header}</div> : null}
      <div ref={scrollerRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-none px-4 pb-4">
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 md:pb-3">
          {footer}
        </div>
      ) : null}
    </div>
  );
}

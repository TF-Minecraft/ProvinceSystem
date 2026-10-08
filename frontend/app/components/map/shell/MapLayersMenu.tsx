"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";

import { useBottomSheetDrag } from "@/app/hooks/useBottomSheetDrag";
import { tileUrl, useTileManifest } from "@/app/hooks/useTileManifest";
import type { TileManifest } from "@/app/lib/map/tilePyramid";

import { DRILL_STACK_OVERLAY_OPACITY, PROVINCE_MODE_OVERLAY_OPACITY } from "../MapCanvas";
import {
  mapModeOptions,
  mapModeTileLayer,
  REGION_TILE_MODES,
} from "../mapModes";
import type { MapId, MapMode } from "../types";
import {
  layerTileButtonClass,
  layerTileFrameClass,
  layerTileIconClass,
  layerTileLabelClass,
  layerTileRingClass,
} from "./layerTiles";
import { LayersIcon, MAP_MODE_ICONS } from "./MapIcons";
import SheetCloseButton from "./SheetCloseButton";

export type MapLayerToggle = {
  id: string;
  label: string;
  hint?: string;
  icon: (props: { size?: number }) => ReactNode;
  /** Hidden on a phone, for tools that only work on a desktop. */
  desktopOnly?: boolean;
  checked: boolean;
  onChange: (next: boolean) => void;
};

/**
 * Where the menu sits. On a phone, a round button under the search that opens
 * a bottom sheet; on a desktop, Google Maps' picture tile in the bottom-left
 * corner, which shows every choice in a strip beside it on hover and opens the
 * full panel above it when clicked.
 */
export type MapLayersPlacement = "phone" | "desktop";

type MapLayersMenuProps = {
  placement: MapLayersPlacement;
  mapType: MapMode;
  onMapTypeChange: (mode: MapMode) => void;
  toggles: MapLayerToggle[];
  /** Extra rows under the panel: the archive link. */
  footer?: ReactNode;
  mapId: MapId;
  /**
   * Draw each map type from the map's own tiles. Off, each shows its icon
   * instead: a staff map's images need a bearer token per request.
   */
  previews: boolean;
};

/** The whole world in one tile: level 0 of a pyramid. */
function wholeMapUrl(mapId: MapId, layer: string, manifest: TileManifest): string {
  return tileUrl(mapId, layer, manifest, 0, 0, 0);
}

/**
 * A map type's preview: the whole world with that mode's colour over it, as
 * the map itself draws it. The mode's icon stands in until the tiles are known,
 * or for good on a map without them.
 */
function ModePreview({
  mapId,
  mode,
  base,
  enabled,
}: {
  mapId: MapId;
  mode: MapMode;
  base: TileManifest | null;
  enabled: boolean;
}) {
  const layer = mapModeTileLayer(mode);
  const overlay = useTileManifest(mapId, layer, enabled).manifest;
  const Glyph = MAP_MODE_ICONS[mode];

  // Plain has no layer of its own: its preview is the base map alone.
  if (!enabled || !base || (layer && !overlay)) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-moss)_70%,var(--tfmc-forest-deep))] text-[var(--tfmc-cream)]">
        <Glyph size={26} />
      </span>
    );
  }
  return (
    <>
      <img
        src={wholeMapUrl(mapId, "base", base)}
        alt=""
        decoding="async"
        fetchPriority="low"
        className="absolute inset-0 h-full w-full object-cover"
      />
      {layer && overlay ? (
        <img
          src={wholeMapUrl(mapId, layer, overlay)}
          alt=""
          decoding="async"
          fetchPriority="low"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: REGION_TILE_MODES.has(mode)
              ? DRILL_STACK_OVERLAY_OPACITY
              : PROVINCE_MODE_OVERLAY_OPACITY,
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Google Maps' layers control: which map to show (realms, the title tiers,
 * the world modes) as a grid of previews, then the overlays that sit on top of
 * any of them. On a phone the panel is a bottom sheet; on a desktop it rises
 * from the corner tile. Choosing a map type in the panel closes it, as does
 * pulling the sheet down; the overlay switches leave it open, so several can
 * be set in one visit.
 */
export default function MapLayersMenu(props: MapLayersMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const panel = open ? (
    <LayersPanel {...props} onClose={() => setOpen(false)} />
  ) : null;

  if (props.placement === "desktop") {
    return (
      <DesktopLayers
        {...props}
        rootRef={rootRef}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        panel={panel}
      />
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="map-control h-10 w-10 rounded-full shadow-[0_4px_14px_rgb(0_0_0/0.35)]"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Layers"
        title="Layers"
        onClick={() => setOpen((value) => !value)}
      >
        <LayersIcon size={20} />
      </button>
      {open ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-black/45"
            onClick={() => setOpen(false)}
          />
          {panel}
        </>
      ) : null}
    </div>
  );
}

/**
 * The desktop corner: a square showing the current map type, labelled
 * Layers. Hovering it (or tabbing to it) unfolds a strip to its right with
 * every map type and overlay, each a click away; clicking the square itself
 * opens the full panel above it, which also holds the archive link.
 */
function DesktopLayers({
  mapType,
  onMapTypeChange,
  toggles,
  mapId,
  previews,
  rootRef,
  open,
  onToggle,
  panel,
}: MapLayersMenuProps & {
  rootRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onToggle: () => void;
  panel: ReactNode;
}) {
  // The strip's previews load on the first hover, not with the page.
  const [warm, setWarm] = useState(false);
  const base = useTileManifest(mapId, "base", previews).manifest;

  return (
    <div
      ref={rootRef}
      className="group/layers pointer-events-none relative flex min-w-0 items-end"
      onPointerEnter={() => setWarm(true)}
      onFocus={() => setWarm(true)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Layers"
        title="Layers"
        onClick={onToggle}
        className={`pointer-events-auto relative h-[4.75rem] w-[4.75rem] shrink-0 overflow-hidden rounded-xl shadow-[0_4px_14px_rgb(0_0_0/0.45)] ring-2 transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] ${
          open
            ? "ring-[var(--tfmc-accent)]"
            : "ring-[color-mix(in_srgb,var(--tfmc-cream)_85%,transparent)] hover:ring-[var(--tfmc-cream)]"
        }`}
      >
        <ModePreview mapId={mapId} mode={mapType} base={base} enabled={previews} />
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/80 to-transparent pb-1 pt-4 text-xs font-medium text-white">
          <LayersIcon size={14} />
          Layers
        </span>
      </button>

      {/* Hidden while the full panel is open. The pause before it folds away
          lets the pointer cross back to the square without it vanishing. */}
      {!open ? (
        <div className="pointer-events-auto invisible min-w-0 pl-2 opacity-0 transition-[opacity,visibility] delay-150 duration-150 group-hover/layers:visible group-hover/layers:opacity-100 group-hover/layers:delay-0 group-has-[:focus-visible]/layers:visible group-has-[:focus-visible]/layers:opacity-100 group-has-[:focus-visible]/layers:delay-0">
          <div
            role="group"
            aria-label="Map type and details"
            className="map-frame flex flex-wrap items-start gap-y-1 px-1 py-1.5"
          >
            {mapModeOptions().map((option) => {
              const active = option.value === mapType;
              return (
                <StripTile
                  key={option.value}
                  label={option.label}
                  active={active}
                  aria-pressed={active}
                  onClick={() => onMapTypeChange(option.value)}
                >
                  <span className={`${stripFrameClass} ${layerTileRingClass(active)}`}>
                    <ModePreview
                      mapId={mapId}
                      mode={option.value}
                      base={base}
                      enabled={previews && warm}
                    />
                  </span>
                </StripTile>
              );
            })}
            {toggles.length > 0 ? (
              <span
                aria-hidden
                className="mx-1 w-px self-stretch bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]"
              />
            ) : null}
            {toggles.map((toggle) => {
              const Glyph = toggle.icon;
              return (
                <StripTile
                  key={toggle.id}
                  label={toggle.label}
                  active={toggle.checked}
                  role="switch"
                  aria-checked={toggle.checked}
                  title={toggle.hint}
                  onClick={() => toggle.onChange(!toggle.checked)}
                >
                  <span
                    className={`${stripFrameClass} ${layerTileRingClass(toggle.checked)} ${layerTileIconClass(toggle.checked)}`}
                  >
                    <Glyph size={24} />
                  </span>
                </StripTile>
              );
            })}
          </div>
        </div>
      ) : null}

      {panel}
    </div>
  );
}

/** The strip's tiles: the panel's, two sizes smaller. */
const stripFrameClass =
  "relative block h-10 w-10 overflow-hidden rounded-lg transition-shadow";

function StripTile({
  label,
  active,
  children,
  ...button
}: {
  label: string;
  active: boolean;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...button}
      className="group flex min-w-[3.25rem] flex-col items-center gap-1 rounded-lg px-1 py-1 text-center focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)]"
    >
      {children}
      {/* One line, so a long label widens its own tile rather than
          deepening the whole strip. */}
      <span
        lang="en"
        className={`whitespace-nowrap text-[11px] leading-tight ${
          active ? "font-semibold text-[var(--tfmc-accent)]" : "text-[var(--tfmc-stone)]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

function LayersPanel({
  mapType,
  onMapTypeChange,
  toggles,
  footer,
  mapId,
  previews,
  onClose,
}: MapLayersMenuProps & { onClose: () => void }) {
  // Once for every preview: the terrain under each mode's colour.
  const base = useTileManifest(mapId, "base", previews).manifest;
  const options = mapModeOptions();
  const sectionGap = "border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]";
  const phoneToggles = toggles.some((toggle) => !toggle.desktopOnly);
  const sheetRef = useRef<HTMLDivElement>(null);
  useBottomSheetDrag(sheetRef, { onClose });

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-label="Map layers"
      className="map-frame map-layers-enter pointer-events-auto fixed inset-x-0 bottom-0 z-40 max-md:bg-[var(--tfmc-forest-deep)] max-h-[78dvh] overflow-y-auto overscroll-none rounded-b-none rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] md:absolute md:inset-x-auto md:bottom-full md:left-0 md:mb-3 md:max-h-[calc(100dvh-var(--tfmc-header-h)-8.5rem)] md:w-[24rem] md:rounded-[10px] md:pb-2"
    >
      {/* Pinned, so the close button stays in reach however far the sheet
          scrolls, as on the details sheet. The upward shadow seals the
          hairline iOS leaves above a sticky bar at a fractional position,
          which otherwise shows the thumbnails scrolling past. */}
      <div className="sticky top-0 z-10 bg-[var(--tfmc-forest-deep)] shadow-[0_-4px_0_var(--tfmc-forest-deep)]">
        <div className="flex justify-center pt-2 md:hidden" aria-hidden>
          <span className="h-1 w-10 rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" />
        </div>
        <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-2 md:px-5 md:pt-4">
          <h2 className="text-lg font-semibold text-[var(--tfmc-cream)]">Map type</h2>
          <SheetCloseButton onClick={onClose} label="Close layers" />
        </div>
      </div>
      <section className="px-3 pb-4 md:px-4">
        {/* Twelve modes, three rows of four in the panel's order: realms,
            the title tiers from the top, then the world modes. */}
        <ul className="grid grid-cols-4 gap-x-1 gap-y-3">
          {options.map((option) => {
            const active = option.value === mapType;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    onMapTypeChange(option.value);
                    onClose();
                  }}
                  className={layerTileButtonClass}
                >
                  <span className={`${layerTileFrameClass} ${layerTileRingClass(active)}`}>
                    <ModePreview
                      mapId={mapId}
                      mode={option.value}
                      base={base}
                      enabled={previews}
                    />
                  </span>
                  <span lang="en" className={layerTileLabelClass(active)}>
                    {option.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {toggles.length > 0 ? (
        <section className={`${sectionGap} px-3 py-4 md:px-4 ${phoneToggles ? "" : "max-md:hidden"}`}>
          <h2 className="mb-3 px-1 text-lg font-semibold text-[var(--tfmc-cream)]">Map details</h2>
          <ul className="grid grid-cols-4 gap-x-1 gap-y-3">
            {toggles.map((toggle) => {
              const Glyph = toggle.icon;
              return (
                <li key={toggle.id} className={toggle.desktopOnly ? "max-md:hidden" : undefined}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={toggle.checked}
                    title={toggle.hint}
                    onClick={() => toggle.onChange(!toggle.checked)}
                    className={layerTileButtonClass}
                  >
                    <span
                      className={`${layerTileFrameClass} ${layerTileRingClass(toggle.checked)} ${layerTileIconClass(toggle.checked)}`}
                    >
                      <Glyph size={28} />
                    </span>
                    <span lang="en" className={layerTileLabelClass(toggle.checked)}>
                      {toggle.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {footer ? <div className={`${sectionGap} px-4 py-3`}>{footer}</div> : null}
    </div>
  );
}

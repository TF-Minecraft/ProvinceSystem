"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { tileUrl, useTileManifest } from "@/app/hooks/useTileManifest";
import type { TileManifest } from "@/app/lib/map/tilePyramid";

import { DRILL_STACK_OVERLAY_OPACITY, PROVINCE_MODE_OVERLAY_OPACITY } from "../MapCanvas";
import {
  mapModeLabel,
  mapModeOptions,
  mapModeTileLayer,
  REGION_TILE_MODES,
} from "../mapModes";
import type { MapId, MapMode } from "../types";
import { CloseIcon, LayersIcon, MAP_MODE_ICONS } from "./MapIcons";

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

type MapLayersMenuProps = {
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

const tileFrameClass =
  "relative block aspect-square w-full max-w-[4.25rem] overflow-hidden rounded-xl transition-shadow";

function tileRingClass(active: boolean): string {
  return active
    ? "ring-[3px] ring-[var(--tfmc-accent)] ring-offset-2 ring-offset-[var(--tfmc-forest-deep)]"
    : "ring-1 ring-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] group-hover:ring-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)]";
}

function tileLabelClass(active: boolean): string {
  return `block text-xs leading-tight hyphens-auto ${
    active ? "font-semibold text-[var(--tfmc-accent)]" : "text-[var(--tfmc-stone)]"
  }`;
}

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

  if (!enabled || !base || !layer || !overlay) {
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
        className="absolute inset-0 h-full w-full object-cover"
      />
      <img
        src={wholeMapUrl(mapId, layer, overlay)}
        alt=""
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          opacity: REGION_TILE_MODES.has(mode)
            ? DRILL_STACK_OVERLAY_OPACITY
            : PROVINCE_MODE_OVERLAY_OPACITY,
        }}
      />
    </>
  );
}

/**
 * Google Maps' layers button and panel, top right: which map to show (realms,
 * the title tiers, the world modes) as a grid of previews, then the overlays
 * that sit on top of any of them. On a phone the panel is a bottom sheet; on
 * a desktop it drops down from the button. Choosing a map type closes it; the
 * overlay switches leave it open, so several can be set in one visit.
 */
export default function MapLayersMenu({
  mapType,
  onMapTypeChange,
  toggles,
  footer,
  mapId,
  previews,
}: MapLayersMenuProps) {
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="map-control h-10 rounded-full px-3.5 text-sm shadow-[0_4px_14px_rgb(0_0_0/0.35)]"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Layers"
        onClick={() => setOpen((value) => !value)}
      >
        <LayersIcon size={18} />
        <span className="sr-only">Layers: </span>
        <span>{mapModeLabel(mapType)}</span>
      </button>
      {open ? (
        <>
          <div
            aria-hidden
            className="fixed inset-0 z-30 bg-black/45 md:hidden"
            onClick={() => setOpen(false)}
          />
          <LayersPanel
            mapType={mapType}
            onMapTypeChange={onMapTypeChange}
            toggles={toggles}
            footer={footer}
            mapId={mapId}
            previews={previews}
            onClose={() => setOpen(false)}
          />
        </>
      ) : null}
    </div>
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

  return (
    <div
      role="dialog"
      aria-label="Map layers"
      className="map-frame map-layers-enter fixed inset-x-0 bottom-0 z-40 max-h-[78dvh] overflow-y-auto overscroll-contain rounded-b-none rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))] md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-2 md:max-h-[calc(100dvh-var(--tfmc-header-h)-6rem)] md:w-[24rem] md:rounded-[10px] md:pb-2"
    >
      <div className="flex justify-center pt-2 md:hidden" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" />
      </div>
      <section className="px-3 pb-4 pt-2 md:px-4 md:pt-4">
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <h2 className="text-lg font-semibold text-[var(--tfmc-cream)]">Map type</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close layers"
            className="-mr-1 rounded-full p-1.5 text-[var(--tfmc-stone)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] hover:text-[var(--tfmc-cream)]"
          >
            <CloseIcon size={22} />
          </button>
        </div>
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
                  className="group flex w-full flex-col items-center gap-1.5 rounded-lg px-0.5 py-1 text-center focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)]"
                >
                  <span className={`${tileFrameClass} ${tileRingClass(active)}`}>
                    <ModePreview
                      mapId={mapId}
                      mode={option.value}
                      base={base}
                      enabled={previews}
                    />
                  </span>
                  <span lang="en" className={tileLabelClass(active)}>
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
                    className="group flex w-full flex-col items-center gap-1.5 rounded-lg px-0.5 py-1 text-center focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)]"
                  >
                    <span
                      className={`${tileFrameClass} ${tileRingClass(toggle.checked)} flex items-center justify-center ${
                        toggle.checked
                          ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_28%,var(--tfmc-forest-deep))] text-[var(--tfmc-cream)]"
                          : "bg-[color-mix(in_srgb,var(--tfmc-cream)_7%,transparent)] text-[var(--tfmc-mist)]"
                      }`}
                    >
                      <Glyph size={28} />
                    </span>
                    <span lang="en" className={tileLabelClass(toggle.checked)}>
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

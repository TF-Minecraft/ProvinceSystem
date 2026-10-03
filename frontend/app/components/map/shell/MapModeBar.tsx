"use client";

import { Fragment } from "react";

import { mapModeLabel, mapModeOptions } from "../mapModes";
import type { MapMode } from "../types";
import { MAP_MODE_ICONS } from "./MapIcons";

type MapModeBarProps = {
  mapType: MapMode;
  onMapTypeChange: (mode: MapMode) => void;
};

/**
 * Desktop map-mode row: round icon buttons in a tray along the bottom edge:
 * realms, then the title tiers from empires down, then the world modes. The
 * caption above the tray always names the active mode, so the icons never
 * have to be decoded from memory.
 */
export function MapModeBar({ mapType, onMapTypeChange }: MapModeBarProps) {
  const options = mapModeOptions();

  return (
    <nav aria-label="Map mode" className="map-frame px-2 pb-2 pt-1.5">
      <p className="mb-1 text-center text-xs text-[var(--tfmc-mist)]">
        {mapModeLabel(mapType)}
      </p>
      <div className="flex items-center gap-1">
        {options.map((option, index) => {
          const Glyph = MAP_MODE_ICONS[option.value];
          const groupBreak =
            index > 0 && options[index - 1].group !== option.group;
          return (
            <Fragment key={option.value}>
              {groupBreak ? (
                <span
                  aria-hidden
                  className="mx-1 h-6 w-px bg-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]"
                />
              ) : null}
              <button
                type="button"
                className="map-medallion"
                aria-pressed={option.value === mapType}
                aria-label={option.label}
                title={option.label}
                onClick={() => onMapTypeChange(option.value)}
              >
                <Glyph size={19} />
              </button>
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Mobile map modes: a scrolling row of labelled chips, like Google Maps'
 * place-type chips. Labels rather than icons alone, since there is no hover
 * to explain them on a phone.
 */
export function MapModeChips({ mapType, onMapTypeChange }: MapModeBarProps) {
  // iOS Safari draws its scroll indicator under a swiped row whatever the
  // scrollbar CSS says. The row gets room below the chips for it, and the
  // wrapper clips that strip off.
  return (
    <div className="-mx-3 overflow-hidden">
      <nav
        aria-label="Map mode"
        className="-mb-3 flex gap-1.5 overflow-x-auto px-3 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {mapModeOptions().map((option) => {
          const Glyph = MAP_MODE_ICONS[option.value];
          const active = option.value === mapType;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onMapTypeChange(option.value)}
              className="map-control h-9 shrink-0 rounded-full px-3 text-sm"
            >
              <Glyph size={16} />
              {option.short}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

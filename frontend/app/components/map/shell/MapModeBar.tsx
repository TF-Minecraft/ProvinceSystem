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
 * Desktop map-mode row: round medallions in a framed tray along the bottom
 * edge, political tiers then world modes, the way CK3 lays out its map modes.
 * The caption above the tray always names the active mode, so the icons never
 * have to be decoded from memory.
 */
export function MapModeBar({ mapType, onMapTypeChange }: MapModeBarProps) {
  const options = mapModeOptions();

  return (
    <nav aria-label="Map mode" className="map-frame px-3 pb-2.5 pt-1.5">
      <p className="map-rule mb-1.5">
        <span className="font-[family-name:var(--font-fraunces)] text-[0.8rem] normal-case tracking-normal text-[var(--tfmc-parchment)]">
          {mapModeLabel(mapType)}
        </span>
      </p>
      <div className="flex items-center gap-1.5">
        {options.map((option, index) => {
          const Glyph = MAP_MODE_ICONS[option.value];
          const groupBreak = index > 0 && options[index - 1].group !== option.group;
          return (
            <Fragment key={option.value}>
              {groupBreak ? (
                <span
                  aria-hidden
                  className="mx-1 h-7 w-px bg-gradient-to-b from-transparent via-[var(--tfmc-gilt-dim)] to-transparent"
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
  return (
    <nav
      aria-label="Map mode"
      className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
  );
}

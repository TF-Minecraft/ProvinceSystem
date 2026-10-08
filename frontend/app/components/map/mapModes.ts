import { PROVINCE_RASTER_MODES } from "@/app/lib/map/chronicleDayModes";

import type { MapMode } from "./types";

/** The kinds of mode, in the layers panel's order: who rules, the title tiers top down, then the land. */
export type MapModeGroup = "realms" | "titles" | "world";

export type MapModeOption = {
  value: MapMode;
  /** Full name, for tooltips and the active-mode caption. */
  label: string;
  group: MapModeGroup;
};

/**
 * One list on every map, live or stored day. A mode with nothing stored for a
 * given day (or a missing PNG on an archived chapter) falls through to
 * MapViewer's missing-capture / empty panel rather than vanishing from the
 * layers panel.
 */
const MODE_OPTIONS: MapModeOption[] = [
  { value: "nation", label: "Realms", group: "realms" },
  { value: "empire", label: "Empires", group: "titles" },
  { value: "kingdom", label: "Kingdoms", group: "titles" },
  { value: "duchy", label: "Duchies", group: "titles" },
  { value: "county", label: "Counties", group: "titles" },
  { value: "province", label: "Provinces", group: "world" },
  { value: "terrain", label: "Terrain", group: "world" },
  { value: "fertility", label: "Fertility", group: "world" },
  // Each area is coloured by the guild that dominates its trade; clicking one
  // opens that guild's card. Trade influence, not territory: guilds own none.
  { value: "trade", label: "Trade", group: "world" },
  { value: "prosperity", label: "Prosperity", group: "world" },
  { value: "infestation", label: "Infestation", group: "world" },
  // The base map on its own: no colours, names, pins or routes.
  { value: "plain", label: "Plain", group: "world" },
];

export function mapModeOptions(): MapModeOption[] {
  return MODE_OPTIONS;
}

export function mapModeLabel(mode: MapMode): string {
  return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

/** Region modes the backend can flatten and tile (`regions-{mode}`). */
export const REGION_TILE_MODES: ReadonlySet<MapMode> = new Set<MapMode>([
  "nation",
  "county",
  "duchy",
  "kingdom",
  "empire",
  "trade",
]);

/**
 * The tile pyramid that colours a mode on the live map: its flattened region
 * shapes or its province raster. Null for Plain, which draws only the base map.
 */
export function mapModeTileLayer(mode: MapMode): string | null {
  if (REGION_TILE_MODES.has(mode)) return `regions-${mode}`;
  if (PROVINCE_RASTER_MODES.has(mode)) return `mapdata-${mode}`;
  return null;
}

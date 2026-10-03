import type { MapMode } from "./types";

export type MapModeGroup = "political" | "world";

export type MapModeOption = {
  value: MapMode;
  /** Full name, for tooltips and the active-mode caption. */
  label: string;
  /** One word, for the mobile chip row. */
  short: string;
  group: MapModeGroup;
};

/**
 * One list on every map, live or stored day. A mode with nothing stored for a
 * given day (or a missing PNG on an archived chapter) falls through to
 * MapViewer's missing-capture / empty panel rather than vanishing from the
 * bar.
 */
const MODE_OPTIONS: MapModeOption[] = [
  { value: "nation", label: "Realms", short: "Realms", group: "political" },
  { value: "county", label: "Counties", short: "Counties", group: "political" },
  { value: "duchy", label: "Duchies", short: "Duchies", group: "political" },
  { value: "kingdom", label: "Kingdoms", short: "Kingdoms", group: "political" },
  { value: "empire", label: "Empires", short: "Empires", group: "political" },
  { value: "province", label: "Provinces", short: "Provinces", group: "world" },
  { value: "terrain", label: "Terrain", short: "Terrain", group: "world" },
  { value: "fertility", label: "Fertility", short: "Fertility", group: "world" },
  // Each area is coloured by the guild that dominates its trade; clicking one
  // opens that guild's card. Trade influence, not territory: guilds own none.
  { value: "trade", label: "Trade", short: "Trade", group: "world" },
  { value: "prosperity", label: "Prosperity", short: "Prosperity", group: "world" },
  { value: "infestation", label: "Infestation", short: "Infestation", group: "world" },
];

export function mapModeOptions(): MapModeOption[] {
  return MODE_OPTIONS;
}

export function mapModeLabel(mode: MapMode): string {
  return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? mode;
}

import type {
  MapMarkersResponse,
  RegionRecord,
  WarExport,
} from "../map/types";
import { filterPlacedInstallations, installationToMapMarker } from "../../lib/installationMarkers";
import {
  filterPlacedSettlements,
  settlementToMapMarker,
  visibleSettlementKind,
} from "../../lib/settlementMarkers";
import { warBattleMarkersFromWars } from "../../lib/warBattleMarkers";
import {
  focusChronicleLabels,
  focusOwnsMarker,
} from "../../lib/map/chronicleFocus";
import type { MapMarker } from "../../lib/mapMarkers";
import type { ChronicleBorderMask } from "../../lib/map/chronicleBorderMask";
import type {
  LabelMapObject,
  NationLabelSpec,
  NationRegionInput,
} from "../../lib/mapLabels";

/**
 * Turning one stored day's raw payloads into the exact arrays the live map's
 * layer components already take. Pure, so the studio's compose preview and its
 * build pass go through the same code and cannot drift apart.
 */

export type ChronicleToggleKey =
  | "nationFill"
  | "nationBorders"
  | "occupation"
  | "tradeLeagues"
  | "prosperity"
  | "nationNames"
  | "settlements"
  | "markerNames"
  | "forts"
  | "fortControl"
  | "wars";

export type ChronicleToggles = Record<ChronicleToggleKey, boolean>;

/** The map opens bare: every layer off, parchment only. */
export const CHRONICLE_TOGGLES_OFF: ChronicleToggles = {
  nationFill: false,
  nationBorders: false,
  occupation: false,
  tradeLeagues: false,
  prosperity: false,
  nationNames: false,
  settlements: false,
  markerNames: false,
  forts: false,
  fortControl: false,
  wars: false,
};

export const CHRONICLE_TOGGLE_ORDER: {
  key: ChronicleToggleKey;
  label: string;
  detail: string;
}[] = [
  { key: "nationFill", label: "Nation fill", detail: "Painted territory" },
  {
    key: "nationBorders",
    label: "Nation borders",
    detail: "Outlines only, no fill",
  },
  {
    key: "occupation",
    label: "Occupation",
    detail: "Held land, greyed and seamed",
  },
  {
    key: "tradeLeagues",
    label: "Trade leagues",
    detail: "League territory, over any fill",
  },
  {
    key: "prosperity",
    label: "Prosperity",
    detail: "Per-province heat, over any fill",
  },
  { key: "nationNames", label: "Nation names", detail: "Realm labels" },
  {
    key: "settlements",
    label: "Settlements & installations",
    detail: "Towns, ports, airports, train stations",
  },
  {
    key: "markerNames",
    label: "Marker names",
    detail: "Name chips under pins",
  },
  { key: "forts", label: "Forts", detail: "Fort pins" },
  {
    key: "fortControl",
    label: "Fort control",
    detail: "Hatched zones of control",
  },
  { key: "wars", label: "Wars", detail: "Campaign lines and battles" },
];

/** Every nation layer reads the same `nation` day file. */
export function needsNationFile(toggles: ChronicleToggles): boolean {
  return (
    toggles.nationFill ||
    toggles.nationBorders ||
    toggles.occupation ||
    toggles.nationNames
  );
}

/**
 * The `trade` day file, which the trade-league fill is the only reader of.
 *
 * Structurally a nation file, but a *separate* fetch: a day can be missing its
 * `trade` capture while its `nation` capture is intact, and a build with only
 * leagues switched on must not pull a nation file nothing draws.
 */
export function needsTradeFile(toggles: ChronicleToggles): boolean {
  return toggles.tradeLeagues;
}

/** The `province_data` day file, which only the prosperity heat map reads. */
export function needsProvinceData(toggles: ChronicleToggles): boolean {
  return toggles.prosperity;
}

/**
 * Settlements, forts, fort zones of control and wars all come out of the one
 * markers payload.
 *
 * `markerNames` is deliberately absent: it fetches nothing of its own and only
 * restyles pins the three layers above already produced.
 */
export function needsMarkers(toggles: ChronicleToggles): boolean {
  return (
    toggles.settlements ||
    toggles.forts ||
    toggles.fortControl ||
    toggles.wars
  );
}

/**
 * Whether the quarter-scale province id grid has to be in hand.
 *
 * Not the same question as `needsNationFile`: `fortControl` paints provinces
 * without reading the nation file at all, and `nationNames` reads the nation
 * file without touching the grid. Deriving the grid fetch from the nation file
 * left a build with only fort control switched on waiting forever on a grid
 * nothing had asked for.
 */
export function needsProvinceGrid(toggles: ChronicleToggles): boolean {
  return (
    toggles.nationFill ||
    toggles.nationBorders ||
    toggles.occupation ||
    toggles.tradeLeagues ||
    toggles.prosperity ||
    toggles.fortControl
  );
}

/**
 * Whether the frame's fill canvas has anything to paint.
 *
 * Four layers share that one canvas — home territory, occupied territory,
 * league territory and the prosperity heat — because they are all the same kind
 * of mark, a province painted a colour, and they are composited into a single
 * province -> colour table by `stackChronicleFillLuts` rather than into four
 * `ImageBitmap`s per frame. So the paint pass runs, and is timed, once for the
 * whole group.
 */
export function paintsChronicleFill(toggles: ChronicleToggles): boolean {
  return (
    toggles.nationFill ||
    toggles.occupation ||
    toggles.tradeLeagues ||
    toggles.prosperity
  );
}

/**
 * Whether anything would actually be drawn. Gates the "Pick a date range"
 * button, so `markerNames` must not count — on its own it draws nothing, and
 * letting it through would offer to build a range of empty frames.
 *
 * `occupation`, `fortControl`, `tradeLeagues` and `prosperity` all count: each
 * paints its own marks with every other layer off — muted occupied land plus
 * its seam, the hatched zones, league territory on bare parchment, the heat
 * wash over the whole map.
 */
export function anyChronicleToggleOn(toggles: ChronicleToggles): boolean {
  return CHRONICLE_TOGGLE_ORDER.some(
    ({ key }) => key !== "markerNames" && toggles[key]
  );
}

/**
 * Identifies a layer set for the build estimate. What a day costs depends
 * entirely on which layers are on — the label pass alone dwarfs the pixel pass —
 * so a timing measured under one set must never be quoted for another. Built
 * from a fixed order so the same set always produces the same string.
 */
export function chronicleToggleSignature(toggles: ChronicleToggles): string {
  const on = CHRONICLE_TOGGLE_ORDER.filter(({ key }) => toggles[key]).map(
    ({ key }) => key
  );
  return on.length ? on.join("+") : "none";
}

/**
 * Same filter the live map applies in `useMapModeData`: a nation with no colour
 * or no land has nothing to paint and no place to hang a label, and letting it
 * through only produces empty label components.
 */
export function chronicleRegionData(
  nationFile: RegionRecord | null
): Record<string, NationRegionInput> {
  // Null-prototype on purpose. Realm ids come from a parsed day file, and
  // `JSON.parse` makes `__proto__` a real own property, so a plain `{}` here
  // turns `out[id] = region` into a call to `Object.prototype.__proto__`'s
  // setter: that realm vanishes from the label layer while `buildNationColorLut`
  // still paints its provinces, and the object then answers truthily for keys it
  // does not have. With no prototype there is no setter and no inherited key.
  const out: Record<string, NationRegionInput> = Object.create(null);
  if (!nationFile) return out;
  for (const [id, region] of Object.entries(nationFile)) {
    if (typeof region?.rgb !== "string") continue;
    if (!Array.isArray(region.provinces) || region.provinces.length === 0) {
      continue;
    }
    out[id] = region;
  }
  return out;
}

/**
 * The label pass asks which realms are on screen through `mapObjects`, which on
 * the live map comes from the drill-down engine. The chronicle has no drill
 * down, so it stands in the engine's own starting answer: a realm is drawn
 * unless it has an overlord, whose suzerain's label already covers its land.
 */
export function chronicleLabelMapObjects(
  regionData: Record<string, NationRegionInput>,
  nationFile: RegionRecord | null
): LabelMapObject[] {
  // `nested`/`baseId` are stated rather than left to be inferred from the id.
  // These are all real region ids — the studio has no drill state and so no
  // synthetic `_nested` entries — and a realm legitimately named `Foo_nested`
  // would otherwise be read as one.
  return Object.keys(regionData).map((id) => ({
    id,
    visible: !nationFile?.[id]?.overlord,
    nested: false,
    baseId: id,
  }));
}

/**
 * Array fields come off the wire and can be malformed. Treat non-arrays as
 * missing data so one bad day cannot interrupt the studio.
 */
function asArray<T>(value: T[] | undefined | null | unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * `focusNationId` narrows the pins to one realm. Both payloads carry an
 * optional `faction_id`, and it holds the same realm ids the nation file is
 * keyed by, so the filter is exact — but it is applied here, on the raw rows,
 * because `MapMarker` deliberately does not carry an owner and adding one for
 * this would put a field on every pin the live map draws.
 */
export function chronicleSettlementMarkers(
  markers: MapMarkersResponse | null,
  labelObjects: LabelMapObject[],
  focusNationId: string | null = null
): MapMarker[] {
  if (!markers) return [];
  return [
    ...filterPlacedSettlements(asArray(markers.settlements))
      .filter((settlement) =>
        focusOwnsMarker(settlement.faction_id, focusNationId)
      )
      .map((settlement) =>
        settlementToMapMarker({
          ...settlement,
          kind: visibleSettlementKind(
            settlement.kind,
            settlement.faction_id,
            labelObjects
          ),
        })
      ),
    ...filterPlacedInstallations(asArray(markers.installations))
      .filter(
        (installation) =>
          installation.kind !== "fort" &&
          focusOwnsMarker(installation.faction_id, focusNationId)
      )
      .map(installationToMapMarker),
  ];
}

export function chronicleFortMarkers(
  markers: MapMarkersResponse | null,
  focusNationId: string | null = null
): MapMarker[] {
  if (!markers) return [];
  return filterPlacedInstallations(asArray(markers.installations))
    .filter(
      (installation) =>
        installation.kind === "fort" &&
        focusOwnsMarker(installation.faction_id, focusNationId)
    )
    .map(installationToMapMarker);
}

export function chronicleWars(
  markers: MapMarkersResponse | null
): WarExport[] {
  return asArray<WarExport>(markers?.wars);
}

export type ChronicleFrameLayers = {
  labels: NationLabelSpec[];
  /** Packed border bitmask for the day, or null when borders are off. */
  borders: ChronicleBorderMask | null;
  /**
   * Packed occupation seam for the day. Only half of the occupation layer —
   * its fill rides in the frame's own colour table, not here, because a
   * province painted a colour is what the fill canvas already does.
   */
  occupationSeam: ChronicleBorderMask | null;
  /** Packed, pre-hatched fort zones of control for the day. */
  fortControl: ChronicleBorderMask | null;
  markers: MapMarker[];
  wars: WarExport[];
};

export const EMPTY_CHRONICLE_LAYERS: ChronicleFrameLayers = {
  labels: [],
  borders: null,
  occupationSeam: null,
  fortControl: null,
  markers: [],
  wars: [],
};

/**
 * Assembles one day's overlay arrays from whatever the enabled toggles pulled.
 * `labels` arrive pre-computed because the label pass needs session geometry
 * the caller owns; everything else is derived here.
 */
export function buildChronicleLayers(options: {
  toggles: ChronicleToggles;
  markers: MapMarkersResponse | null;
  labels: NationLabelSpec[];
  labelObjects: LabelMapObject[];
  /**
   * Pre-computed like `labels`, and for the same reason: the border pass needs
   * the province grid, which the caller owns for the whole session rather than
   * per day.
   */
  borders?: ChronicleBorderMask | null;
  /** Pre-computed for the same reason `borders` is: both walk the grid. */
  occupationSeam?: ChronicleBorderMask | null;
  /** Pre-computed for the same reason `borders` is: both walk the grid. */
  fortControl?: ChronicleBorderMask | null;
  /**
   * The realm the frame is narrowed to, or null for the whole map.
   *
   * Applied here rather than in the studio so the compose preview, the built
   * frames and the GIF export are narrowed by one piece of code. A focus that
   * held for the preview and quietly lapsed in the export is the bug this
   * feature invites, and a second copy of the filter is how it gets in.
   */
  focusNationId?: string | null;
}): ChronicleFrameLayers {
  const {
    toggles,
    markers,
    labels,
    labelObjects,
    borders = null,
    occupationSeam = null,
    fortControl = null,
    focusNationId = null,
  } = options;
  const pins: MapMarker[] = [];
  // Name chips are decided here rather than in `MapMarkerLayer` because the
  // per-kind default is baked into the markers themselves: installations, forts
  // and battles ship `showLabelOnlyOnHover: true`, and a built timelapse is
  // never hovered, so those pins would be permanently nameless. One stamp over
  // every pin makes the toggle mean the same thing for all of them.
  const nameChips = toggles.markerNames;

  if (toggles.settlements) {
    pins.push(
      ...chronicleSettlementMarkers(markers, labelObjects, focusNationId)
    );
  }
  if (toggles.forts) {
    pins.push(...chronicleFortMarkers(markers, focusNationId));
  }
  if (toggles.wars) {
    // Wars and their battle pins are deliberately left whole under a focus.
    // `WarExport` names its sides by *leader* id (`attacker_leader_id`,
    // `defender_leader_id`) and its `belligerents` list is untyped and unread
    // anywhere else in the app, so there is no field here that reliably says
    // which realm a campaign belongs to. Guessing one would drop the wars a
    // realm is actually fighting; showing them all is merely more than asked.
    pins.push(...warBattleMarkersFromWars(chronicleWars(markers)));
  }

  return {
    labels: toggles.nationNames
      ? focusChronicleLabels(labels, focusNationId)
      : [],
    borders: toggles.nationBorders ? borders : null,
    occupationSeam: toggles.occupation ? occupationSeam : null,
    fortControl: toggles.fortControl ? fortControl : null,
    markers: pins.map((pin) => ({
      ...pin,
      showLabelOnlyOnHover: !nameChips,
    })),
    wars: toggles.wars ? chronicleWars(markers) : [],
  };
}

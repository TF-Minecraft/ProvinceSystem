import type { MapObject, RegionRecord } from "@/app/components/map/types";

import { MAX_PAINTABLE_PROVINCE_ID } from "./chroniclePaint";
import type { NationOwnership } from "./chroniclePaint";

/**
 * Turns a chronicle day's `nation.json` into the ownership records the
 * client-side painter consumes, in the three flavours the live map gets for
 * free from server-rendered PNGs:
 *
 * - `directOwnership` reproduces `/{map}/mapdata/{mode}` — the *pick* image.
 * - `visibleOwnership` reproduces the `/{map}/regions/{mode}/{path}` overlays,
 *   and the hovered-nation `{path}_hover` highlight is that same record read
 *   back for one id — see `ChronicleOwnershipLayer`.
 *
 * Everything here treats `regionData` as unvalidated network JSON: a stored day
 * is a file on disk that no schema guards. Three constraints run through the
 * whole module.
 *
 * 1. Every returned record is built with `Object.create(null)` so region names
 *    such as `__proto__` remain ordinary keys. Assigning that name to a plain
 *    object changes its prototype, hiding the realm from labels while its land
 *    remains painted.
 * 2. Every `subjects`/`overlord` walk carries a visited `Set`. A cycle in the
 *    stored data would otherwise spin forever, and there is no error boundary
 *    anywhere under `app/`, so a hang or a throw takes the whole page down.
 * 3. Nothing here is allowed to be superlinear in the file. A day file is
 *    capped by size, not by shape, so a few hundred KB can describe hundreds
 *    of thousands of region-to-region edges; `visibleOwnership` runs inside a
 *    render-time `useMemo`, so anything worse than linear is a hang before
 *    first paint. See `visibleOwnership` for the shared visited set, and
 *    `keepPaintableProvinces` for the per-province bound.
 */

type Region = RegionRecord[string];

/**
 * Own-property read. `regionData` comes from `JSON.parse`, where `__proto__` is
 * an ordinary own key — but for any id the file does *not* carry, a bare
 * `regionData[id]` would hand back something off `Object.prototype` (a
 * function for `toString`, the prototype object itself for `__proto__`).
 */
function readRegion(
  regionData: RegionRecord | null | undefined,
  regionId: string
): Region | null {
  if (!regionData || typeof regionId !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(regionData, regionId)) return null;
  const region = regionData[regionId];
  if (!region || typeof region !== "object") return null;
  return region as Region;
}

function ownProvinces(region: Region | null): number[] {
  if (!region || !Array.isArray(region.provinces)) return [];
  return region.provinces;
}

/**
 * Province ids that could actually be painted, in file order.
 *
 * `ProvinceIdGrid.ids` is a `Uint16Array`, so `MAX_PAINTABLE_PROVINCE_ID` is
 * the largest id any pixel can name; `buildNationColorLut` already clamps to
 * it when sizing its `Uint32Array`. Filtering here as well bounds the plain
 * `number[]`s this module accumulates — which the LUT clamp does nothing for —
 * so a day file cannot make an ownership record hold ids it could never draw.
 * Non-integers, negatives, `0` (the unowned sentinel) and anything above the
 * clamp are dropped.
 */
function keepPaintableProvinces(ids: number[]): number[] {
  const kept: number[] = [];
  for (const id of ids) {
    if (Number.isInteger(id) && id > 0 && id <= MAX_PAINTABLE_PROVINCE_ID) {
      kept.push(id);
    }
  }
  return kept;
}

function subjectIds(region: Region | null): string[] {
  if (!region || !Array.isArray(region.subjects)) return [];
  return region.subjects.filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );
}

/**
 * `rootId`'s own provinces plus every subject's, transitively.
 *
 * `visited` is supplied by the caller and does double duty:
 *
 * - it is the cycle guard, so `A -> B -> A` in a stored file terminates after
 *   two pops instead of hanging the tab;
 * - it is shared across every call within one `visibleOwnership` pass, which
 *   is what makes that pass linear in the file rather than quadratic. A day
 *   file whose regions all lack `overlord` (so all are visible) and form a
 *   subjects chain would otherwise walk the whole tail from every root: 8 000
 *   such regions accumulated 32 million province entries.
 *
 * The shared set means a region is charged to exactly one visible root. In a
 * well-formed hierarchy that is no change at all — a region has one visible
 * ancestor. On a corrupt multi-parent day the winner is whichever root reaches
 * it first in `mapObjects` order, which is arbitrary but bounded; the previous
 * behaviour gave it to every parent, which is what exploded.
 */
function collectSubtreeProvinces(
  regionData: RegionRecord | null | undefined,
  rootId: string,
  visited: Set<string>
): number[] {
  const provinces: number[] = [];
  const stack: string[] = [rootId];

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const region = readRegion(regionData, id);
    if (!region) continue;

    for (const province of keepPaintableProvinces(ownProvinces(region))) {
      provinces.push(province);
    }
    for (const subjectId of subjectIds(region)) {
      if (!visited.has(subjectId)) stack.push(subjectId);
    }
  }

  return provinces;
}

/**
 * Every region painted in its own colour over its *own* provinces, with
 * visibility and drill state ignored entirely.
 *
 * This is deliberately not "what you see". It reproduces `/mapdata/{mode}`,
 * the pick image, which is coloured by **direct owner** — that is exactly why
 * `MapEngineContext.getHoverRegion` takes the picked id and walks *up* the
 * `overlord` chain looking for a visible ancestor. Roll a vassal's provinces
 * into its overlord here and hovering that vassal would resolve to the wrong
 * nation, silently, on every historical day.
 *
 * Because `rgbToId` in `useMapHover` is built from the same day's `regionData`,
 * a pick canvas painted from this record makes hover, click, nation details and
 * drill-down day-correct with no change to any hover code.
 */
export function directOwnership(
  regionData: RegionRecord | null | undefined
): NationOwnership {
  const ownership: NationOwnership = Object.create(null);
  if (!regionData) return ownership;

  for (const regionId of Object.keys(regionData)) {
    const region = readRegion(regionData, regionId);
    if (!region?.rgb) continue;
    ownership[regionId] = {
      rgb: region.rgb,
      provinces: ownProvinces(region),
    };
  }

  return ownership;
}

/**
 * What the live region overlays show, honouring the current drill state.
 *
 * `mapObjects` (see `core/mapObjectBuilder.ts`) holds one entry per region id
 * plus an `${id}_nested` entry for any region with subjects, and only
 * `visible === true` entries are drawn. The two visible shapes mean different
 * things:
 *
 * - a visible **base** entry is the region *plus all of its subjects,
 *   transitively* — at the top level an overlord's shape covers its vassals;
 * - a visible **`_nested`** entry is that region's **own provinces only** —
 *   the drilled-in state, where `drillDownRegion` has also switched each
 *   subject's own base entry visible alongside it.
 *
 * Colour is always the base region's own `rgb` in both cases.
 *
 * Structure is read off the entry (`obj.nested` / `obj.baseId`), never
 * recovered from `obj.id`. Region ids are day-file object keys — player-set
 * names — so a real region named `Foo_nested` has the same id string as the
 * synthetic entry for `Foo`. Inferring structure from that suffix gives its
 * ownership slot to `Foo`, leaving its land transparent but still hoverable
 * through `directOwnership`.
 *
 * Conflict rule: entries are applied in `mapObjects` order, and the later entry
 * wins a province id claimed twice. That matches `buildNationColorLut`, which
 * walks `Object.values` in insertion order and lets the last writer keep the
 * pixel — so painting order and colour-table order agree. Overlaps are not
 * supposed to occur (a drilled overlord contributes only its own land, and its
 * subjects contribute theirs), so this only decides genuinely corrupt days.
 * A base and its `_nested` twin both visible is likewise not a state the engine
 * produces; if a day forced it, the `_nested` (own-provinces-only) reading
 * replaces the rolled-up one for that region.
 *
 * Bounds: one visited set is shared by every subtree walk in a single call, so
 * the total work — and the total province entries retained — is linear in the
 * day file, and each region's provinces land under exactly one visible root.
 * Province ids outside `(0, MAX_PAINTABLE_PROVINCE_ID]` are dropped, so no
 * record can carry an id the painter could not have drawn.
 */
export function visibleOwnership(
  regionData: RegionRecord | null | undefined,
  mapObjects: MapObject[] | null | undefined
): NationOwnership {
  const ownership: NationOwnership = Object.create(null);
  if (!regionData || !Array.isArray(mapObjects)) return ownership;

  const visited = new Set<string>();

  for (const obj of mapObjects) {
    if (!obj || obj.visible !== true || typeof obj.id !== "string") continue;

    const nested = obj.nested === true;
    const baseId = typeof obj.baseId === "string" ? obj.baseId : obj.id;
    const region = readRegion(regionData, baseId);
    if (!region?.rgb) continue;

    ownership[baseId] = {
      rgb: region.rgb,
      provinces: nested
        ? keepPaintableProvinces(ownProvinces(region))
        : collectSubtreeProvinces(regionData, baseId, visited),
    };
  }

  return ownership;
}

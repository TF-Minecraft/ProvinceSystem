import { useEffect, useState } from "react";

import type { MapId, MapMode } from "../components/map/types";
import type { TitleEntity, TitleLayers } from "../lib/titleProvinces";
import { isChronicleDayFileMissing } from "../lib/map/chronicleData";
import { fetchMapModeRegionData, mapModeDataSource } from "../lib/map/dataSource";

const tierCache = new Map<string, Record<string, TitleEntity>>();

/**
 * Nested title extras (`county` / `duchy` / `kingdom`) are day-varying: they
 * are captured with the rest of the chronicle. This cache is module-level and
 * survives client-side navigation from the live map onto a stored day, so the
 * day is part of the key. Serving a live extra under a date banner would be
 * fabricated history; serving one day's extra to another day would mix two
 * captures. Keying on the day costs one template literal and makes both
 * classes of bug impossible.
 *
 * The active tier never goes through `fetchTier`: it arrives as `regionData`
 * from `useMapModeData` / `CHRONICLE_MODE_SOURCE`. Extras are the lower tiers
 * `EXTRA_FETCHES` asks for so rollup can walk titles → provinces.
 */
function cacheKey(mapId: MapId, tier: string, day: string | null): string {
  return `${mapId}:${day ?? "live"}:${tier}`;
}

/**
 * Live-leak tripwire for nested extras. On the live map any extra may use the
 * live endpoint. Under a stored day the extra must resolve to a chronicle
 * day file — never `live`, even if someone later classifies that tier static.
 * Throwing is a missing nested layer, not today's titles under a past date.
 */
export function assertDayScopedTitleExtra(mapId: MapId, tier: string, day: string | null): void {
  if (day === null) return;
  const source = mapModeDataSource(mapId, tier as MapMode, day);
  if (source.kind !== "day") {
    throw new Error(`useTitleLayerData refuses to fetch live "${tier}" under chronicle day ${day}`);
  }
}

async function fetchTier(
  mapId: MapId,
  tier: MapMode,
  sessionToken?: string | null,
  day: string | null = null,
): Promise<Record<string, TitleEntity>> {
  const key = cacheKey(mapId, tier, day);
  const cached = tierCache.get(key);
  if (cached) return cached;

  assertDayScopedTitleExtra(mapId, tier, day);
  const data = (await fetchMapModeRegionData({
    mapId,
    mapType: tier,
    day,
    sessionToken,
  })) as Record<string, TitleEntity>;
  tierCache.set(key, data);
  return data;
}

/** Lower title tiers loaded so the active mode can roll up nested provinces. */
export const EXTRA_FETCHES: Partial<Record<MapMode, MapMode[]>> = {
  duchy: ["county"],
  kingdom: ["duchy", "county"],
  empire: ["kingdom", "duchy", "county"],
};

const ACTIVE_TIER: Partial<Record<MapMode, keyof TitleLayers>> = {
  county: "county",
  duchy: "duchy",
  kingdom: "kingdom",
  empire: "empire",
  trade: "trade",
};

function layersWithActive(activeTier: keyof TitleLayers, regionData: Record<string, TitleEntity>): TitleLayers {
  const next: TitleLayers = { county: {} };
  if (activeTier === "duchy") next.duchy = regionData;
  else if (activeTier === "kingdom") next.kingdom = regionData;
  else if (activeTier === "empire") next.empire = regionData;
  return next;
}

export function useTitleLayerData(
  mapId: MapId,
  mapType: MapMode,
  regionData: Record<string, TitleEntity> | null,
  sessionToken?: string | null,
  /** A chronicle day, or `null` for the live map. See `cacheKey`. */
  day: string | null = null,
): { layers: TitleLayers | null; loading: boolean } {
  const [layers, setLayers] = useState<TitleLayers | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const activeTier = ACTIVE_TIER[mapType];
    if (!activeTier || !regionData) {
      setLayers(null);
      setLoading(false);
      return;
    }

    const extra = EXTRA_FETCHES[mapType] ?? [];
    if (extra.length === 0) {
      const next: TitleLayers = { county: {} };
      if (activeTier === "county") next.county = regionData;
      else if (activeTier === "trade") next.trade = regionData;
      setLayers(next);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      extra.map((tier) =>
        fetchTier(mapId, tier, sessionToken, day).catch((err: unknown) => {
          if (isChronicleDayFileMissing(err)) {
            return {} as Record<string, TitleEntity>;
          }
          throw err;
        }),
      ),
    )
      .then((fetched) => {
        if (cancelled) return;

        const next = layersWithActive(activeTier, regionData);
        extra.forEach((tier, index) => {
          const data = fetched[index];
          if (tier === "county") next.county = data ?? {};
          else if (tier === "duchy") next.duchy = data;
          else if (tier === "kingdom") next.kingdom = data;
        });

        setLayers(next);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("useTitleLayerData:", err);
        setLayers(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, mapType, regionData, sessionToken, day]);

  return { layers, loading };
}

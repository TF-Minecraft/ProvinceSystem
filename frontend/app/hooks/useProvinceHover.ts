// hooks/mapHover/useProvinceHover.ts
import { useCallback, useEffect, useRef } from "react";

import type { MapId } from "../components/map/types";
import { fetchMapJson } from "@/lib/map/api";
import { fetchChronicleDayFile } from "../lib/map/chronicleData";
import {
  buildProvinceCountyNames,
  type CountyNameEntry,
} from "../lib/map/provinceCounty";

/**
 * The subset of a province the tooltip actually renders. The live
 * `/compiled_data/provinces` payload is a superset of this; a stored day's
 * `province_data` carries the stored province quantities used by chronicle
 * hover, while live compiled data is a superset.
 */
export type TooltipProvince = {
  prosperity: number;
  trade_shares: Record<string, number>;
  terrain?: string;
};

/**
 * Normalises a stored day's per-guild trade into the same ratio map the live
 * payload ships as `trade_shares`.
 *
 * The two shapes are genuinely different: live gives
 * `trade_shares: { Lantan: 1.0 }` (already a ratio), while a stored day gives
 * `trade: { Lantan: { trade: 0.73, production: 0.0 } }` (raw magnitudes). Only
 * the `trade` leg is summed, matching what the backend normalises live.
 *
 * Every read is shape-checked: this is unvalidated JSON out of an immutable
 * stored file, and there is no error boundary under `app/`.
 */
export function storedTradeShares(trade: unknown): Record<string, number> {
  const shares: Record<string, number> = Object.create(null);
  if (!trade || typeof trade !== "object" || Array.isArray(trade)) return shares;

  const amounts: Array<[string, number]> = [];
  let total = 0;

  for (const [guild, value] of Object.entries(
    trade as Record<string, unknown>
  )) {
    const raw =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as { trade?: unknown }).trade
        : value;
    const amount = typeof raw === "number" ? raw : Number.NaN;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    amounts.push([guild, amount]);
    total += amount;
  }

  if (total <= 0) return shares;
  for (const [guild, amount] of amounts) shares[guild] = amount / total;
  return shares;
}

/**
 * `province_data` is a **list** keyed by `id`, not an object map like
 * `/compiled_data/provinces`. Indexing it once per day keeps the hover path a
 * plain lookup.
 */
export function indexStoredProvinceData(
  value: unknown
): Record<number, TooltipProvince> {
  const byId: Record<number, TooltipProvince> = Object.create(null);
  if (!Array.isArray(value)) return byId;

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown> & { id?: unknown; prosperity?: unknown; trade?: unknown };
    const id = typeof row.id === "number" ? row.id : Number.NaN;
    if (!Number.isInteger(id)) continue;
    const province: TooltipProvince = {
      prosperity:
        typeof row.prosperity === "number" && Number.isFinite(row.prosperity)
          ? row.prosperity
          : 0,
      trade_shares: storedTradeShares(row.trade),
    };
    if (typeof row.terrain === "string") province.terrain = row.terrain;
    byId[id] = province;
  }

  return byId;
}

/**
 * What a province hover produced this frame.
 *
 * - `consumed`: the mode is a province-tooltip mode and owns the pointer;
 *   region hover must not run.
 * - `lines`: the tooltip lines, worked out synchronously from data already in
 *   memory; `null` when there is nothing to show here (sea, no data); and
 *   `undefined` when the answer is coming over the network and the tooltip will
 *   be set when it lands (the fallback when no province grid is available).
 */
export type ProvinceHoverResult = {
  consumed: boolean;
  lines: string[] | null | undefined;
};

/** Live modes whose hover reads `/compiled_data/provinces`. */
const PROVINCE_FIGURE_MODES = new Set([
  "terrain",
  "fertility",
  "prosperity",
  "infestation",
  "trade",
]);

export function useProvinceHover({
  mapId,
  mapType,
  setCursorTooltip,
  guildNameCacheRef,
  sessionToken,
  day = null,
  resolveProvinceId,
  onDataReady,
}: {
  mapId: MapId;
  mapType: string;
  setCursorTooltip: (v: any) => void;
  guildNameCacheRef: React.MutableRefObject<Record<string, string>> | null;
  sessionToken?: string | null;
  /**
   * A chronicle day, or `null` for the live map. Non-null switches the
   * prosperity/trade/infestation path off `/compiled_data/provinces` and
   * `/province/{x},{y}/meta`, which are recomputed from today's state.
   * `province` mode is the exception: `/meta` reads provinces.png and
   * provinces.txt (static input), and `/data/county` is de jure structure,
   * so both stay live under a stored day.
   */
  day?: string | null;
  /**
   * Map pixel -> province id, resolved client-side from the quarter-scale
   * province id grid. With it, a hover costs no request: the id comes from the
   * grid and the province's figures from data fetched once. Without it (the
   * grid not loaded yet) the live path falls back to the server's `/meta`.
   */
  resolveProvinceId?: (x: number, y: number) => number | null;
  /**
   * Called once the province figures have arrived, so whatever is under the
   * pointer can be shown. A mouse would show it on its next move; a tap has
   * no next move.
   */
  onDataReady?: () => void;
}) {
  const provinceCache = useRef<Record<number, any>>({});
  /** Stored `province_data`, indexed by id, keyed by `mapId:day`. */
  const dayCacheRef = useRef<{
    key: string;
    byId: Record<number, TooltipProvince>;
  } | null>(null);
  const dayPendingRef = useRef<string | null>(null);
  /** Live `county.json` names, keyed by `mapId`. */
  const countyCacheRef = useRef<{
    key: string;
    names: Map<number, string>;
  } | null>(null);
  const countyPendingRef = useRef<string | null>(null);

  /** `/compiled_data/provinces` for the live map, fetched once per map. */
  const liveCompiledRef = useRef<{ key: string; byId: Record<number, any> } | null>(
    null
  );
  const liveCompiledPendingRef = useRef<string | null>(null);

  const onDataReadyRef = useRef(onDataReady);
  onDataReadyRef.current = onDataReady;

  /** Fetch the live province figures once per map, then say so. */
  const loadLiveCompiled = useCallback(() => {
    if (liveCompiledRef.current?.key === mapId || liveCompiledPendingRef.current === mapId) {
      return;
    }
    liveCompiledPendingRef.current = mapId;
    void fetchMapJson<Record<number, any>>(`/${mapId}/compiled_data/provinces`, {
      sessionToken,
    })
      .then((all) => {
        liveCompiledRef.current = { key: mapId, byId: all ?? {} };
        onDataReadyRef.current?.();
      })
      .catch(() => {
        liveCompiledPendingRef.current = null;
      });
  }, [mapId, sessionToken]);

  // Fetched on entering a mode that reads them, not on the first hover, so
  // the first tap on a phone already has them.
  useEffect(() => {
    if (day !== null || !PROVINCE_FIGURE_MODES.has(mapType)) return;
    loadLiveCompiled();
  }, [day, mapType, loadLiveCompiled]);

  const capitalize = (v: string) => v[0].toUpperCase() + v.slice(1);

  const handleProvinceHover = (
    x: number,
    y: number,
    screenX: number,
    screenY: number
  ): ProvinceHoverResult => {
    const active =
      mapType === "terrain" ||
      mapType === "fertility" ||
      mapType === "prosperity" ||
      mapType === "infestation" ||
      mapType === "trade" ||
      mapType === "province";

    const consumesHover =
      mapType === "terrain" ||
      mapType === "fertility" ||
      mapType === "prosperity" ||
      mapType === "infestation" ||
      mapType === "province";

    if (!active) return { consumed: false, lines: null };

    /** The tooltip lines for one province's data, or null for none. */
    const buildLines = (data: any): string[] | null => {
      if (!data || data.terrain === "sea" || data.terrain === "water") return null;

      const lines = [`x: ${x}  z: ${y}`];

      if (mapType === "terrain")
        lines.push(`Terrain: ${capitalize(data.terrain)}`);
      if (mapType === "fertility") lines.push(`Fertility: ${data.fertility}`);
      if (mapType === "prosperity")
        lines.push(`Prosperity: ${data.prosperity ?? 0}`);
      if (mapType === "infestation") {
        const severity = data.infestation_severity;
        const group = data.infestation_display || data.infestation_group;
        if (severity) {
          const label =
            String(severity).charAt(0).toUpperCase() +
            String(severity).slice(1);
          lines.push(
            group
              ? `Infestation: ${label} (${group})`
              : `Infestation: ${label}`
          );
        } else {
          lines.push("Infestation: None");
        }
      }

      if (
        (mapType === "trade" || mapType === "prosperity") &&
        data.trade_shares
      ) {
        const entries = Object.entries(
          data.trade_shares as Record<string, number>
        ).sort((a, b) => b[1] - a[1]);

        let used = 0;
        const max = Math.min(5, entries.length);

        lines.push("Trade:");

        for (let i = 0; i < max; i++) {
          const [guild, ratio] = entries[i];
          used += ratio;

          const name =
            guildNameCacheRef?.current[guild] ?? guild.replace(/_/g, " ");

          lines.push(`• ${name}: ${(ratio * 100).toFixed(1)}%`);
        }

        const remaining = 1 - used;
        if (remaining > 0.01) {
          lines.push(`• Other: ${(remaining * 100).toFixed(1)}%`);
        }
      }

      return lines;
    };

    const render = (data: any) => {
      if (!data) return;
      const lines = buildLines(data);
      // Water and sea have nothing to show; clear the last province's tooltip.
      if (!lines) {
        setCursorTooltip(null);
        return;
      }
      setCursorTooltip({
        x: screenX,
        y: screenY,
        text: lines.join("\n"),
      });
    };

    // Live map with the province grid in memory: answer this frame, with no
    // request. Trade and prosperity read the same compiled figures.
    if (day === null && mapType !== "province" && resolveProvinceId) {
      const compiled = liveCompiledRef.current;
      if (compiled?.key !== mapId) {
        loadLiveCompiled();
        return { consumed: consumesHover, lines: null };
      }
      const pid = resolveProvinceId(x, y);
      return {
        consumed: consumesHover,
        lines: pid ? buildLines(compiled.byId[pid]) : null,
      };
    }

    if (mapType === "province" && resolveProvinceId) {
      const pid = resolveProvinceId(x, y);
      if (!pid) return { consumed: consumesHover, lines: null };
      const compiled = liveCompiledRef.current;
      const names = countyCacheRef.current?.key === mapId ? countyCacheRef.current.names : null;
      if (compiled?.key !== mapId && liveCompiledPendingRef.current !== mapId) {
        liveCompiledPendingRef.current = mapId;
        void fetchMapJson<Record<number, any>>(`/${mapId}/compiled_data/provinces`, {
          sessionToken,
        })
          .then((all) => {
            liveCompiledRef.current = { key: mapId, byId: all ?? {} };
          })
          .catch(() => {
            liveCompiledPendingRef.current = null;
          });
      }
      if (!names && countyPendingRef.current !== mapId) {
        countyPendingRef.current = mapId;
        void fetchMapJson<Record<string, CountyNameEntry>>(`/${mapId}/data/county`, {
          sessionToken,
        })
          .then((counties) => {
            countyCacheRef.current = { key: mapId, names: buildProvinceCountyNames(counties) };
          })
          .catch(() => {
            countyCacheRef.current = { key: mapId, names: new Map() };
          });
      }
      const terrain = compiled?.key === mapId ? compiled.byId[pid]?.terrain : undefined;
      const lines = [`x: ${x}  z: ${y}`, `Province: ${pid}`];
      if (typeof terrain === "string" && terrain.length > 0) {
        lines.push(`Terrain: ${capitalize(terrain)}`);
      }
      const county = names?.get(pid);
      if (county) lines.push(`County: ${county}`);
      return { consumed: consumesHover, lines };
    }

    if (mapType === "province") {
      const renderProvince = (
        pid: number,
        terrain: unknown,
        names: Map<number, string> | null
      ) => {
        const lines = [`x: ${x}  z: ${y}`, `Province: ${pid}`];
        if (typeof terrain === "string" && terrain.length > 0) {
          lines.push(`Terrain: ${capitalize(terrain)}`);
        }
        const county = names?.get(pid);
        if (county) lines.push(`County: ${county}`);
        setCursorTooltip({
          x: screenX,
          y: screenY,
          text: lines.join("\n"),
        });
      };

      void fetchMapJson<{ province_id?: number; terrain?: unknown }>(
        `/${mapId}/province/${x},${y}/meta`,
        { sessionToken, cache: "no-store" }
      )
        .then((meta) => {
          if (!meta?.province_id) return;
          const pid = meta.province_id;
          const cached = countyCacheRef.current;
          if (cached?.key === mapId) {
            renderProvince(pid, meta.terrain, cached.names);
            return;
          }
          renderProvince(pid, meta.terrain, null);
          if (countyPendingRef.current === mapId) return;
          countyPendingRef.current = mapId;
          void fetchMapJson<Record<string, CountyNameEntry>>(
            `/${mapId}/data/county`,
            { sessionToken }
          )
            .then((counties) => {
              const names = buildProvinceCountyNames(counties);
              countyCacheRef.current = { key: mapId, names };
              renderProvince(pid, meta.terrain, names);
            })
            .catch(() => {
              countyCacheRef.current = { key: mapId, names: new Map() };
            });
        })
        .catch(() => {});

      return { consumed: consumesHover, lines: undefined };
    }

    if (day !== null) {
      // Stored day: province id comes from the grid already in memory, and the
      // province's own numbers come from that day's `province_data`. No live
      // request is issued from this path at all.
      const pid = resolveProvinceId?.(x, y) ?? null;
      if (!pid) return { consumed: consumesHover, lines: null };

      const key = `${mapId}:${day}`;
      const cached = dayCacheRef.current;
      if (cached?.key === key) {
        // Returned rather than drawn: the caller folds these lines into the
        // region tooltip for trade, so the two never take turns on screen.
        return { consumed: consumesHover, lines: buildLines(cached.byId[pid]) };
      }

      if (dayPendingRef.current !== key) {
        dayPendingRef.current = key;
        void fetchChronicleDayFile<unknown>(
          mapId,
          day,
          "province_data",
          sessionToken
        )
          .then((file) => {
            const byId = indexStoredProvinceData(file.value);
            dayCacheRef.current = { key, byId };
            // Paint the hover that triggered the load, so a user who hovers
            // once and holds still is not left with no tooltip until they
            // move. Any later move overwrites it from the cache.
            render(byId[pid]);
          })
          .catch(() => {
            // A day with no `province_data` simply shows no province tooltip.
            // Cache the empty result so hovering does not retry every frame.
            dayCacheRef.current = { key, byId: Object.create(null) };
          });
      }

      return { consumed: consumesHover, lines: undefined };
    }

    // Trade shares its tooltip with region hover. An answer that lands a
    // moment later would replace the region tooltip and then be replaced back
    // on the next move — the flicker this path used to cause — so without the
    // grid, trade just shows the region.
    if (!consumesHover) return { consumed: false, lines: null };

    void fetchMapJson<{ province_id?: number }>(
      `/${mapId}/province/${x},${y}/meta`,
      { sessionToken, cache: "no-store" }
    )
      .then((meta) => {
        if (!meta?.province_id) return;

        const pid = meta.province_id;

        if (!provinceCache.current[pid]) {
          void fetchMapJson<Record<number, any>>(
            `/${mapId}/compiled_data/provinces`,
            { sessionToken, cache: "no-store" }
          ).then((all) => {
            provinceCache.current = all;
            render(all[pid]);
          });
        } else {
          render(provinceCache.current[pid]);
        }
      })
      .catch(() => {});

    return { consumed: consumesHover, lines: undefined };
  };

  return { handleProvinceHover };
}

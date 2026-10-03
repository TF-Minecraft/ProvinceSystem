// hooks/mapHover/useProvinceHover.ts
import { useRef } from "react";

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
  terrain_value?: number;
  infrastructure?: number;
  infrastructure_fill?: number;
  effective_terrain?: number;
};

export function infrastructureHoverText(data: Partial<TooltipProvince>): string {
  const terrain = typeof data.terrain === "string" ? data.terrain : "";
  const terrainLabel = terrain ? terrain[0]!.toUpperCase() + terrain.slice(1) : "";
  const terrainValue = Number.isFinite(data.terrain_value)
    ? ` ${(data.terrain_value as number).toFixed(2)}`
    : "";
  let detail = `${terrainLabel}${terrainValue}`;
  if (
    Number.isFinite(data.infrastructure_fill) &&
    Number.isFinite(data.effective_terrain)
  ) {
    detail += `${detail ? ", " : ""}infrastructure ${Math.round((data.infrastructure_fill as number) * 100)}%, counts as ${(data.effective_terrain as number).toFixed(2)}`;
  }
  return detail;
}

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
    for (const field of ["terrain_value", "infrastructure", "infrastructure_fill", "effective_terrain"] as const) {
      const number = row[field];
      if (typeof number === "number" && Number.isFinite(number)) province[field] = number;
    }
    byId[id] = province;
  }

  return byId;
}

export function useProvinceHover({
  mapId,
  mapType,
  setCursorTooltip,
  guildNameCacheRef,
  sessionToken,
  day = null,
  resolveProvinceId,
}: {
  mapId: MapId;
  mapType: string;
  setCursorTooltip: (v: any) => void;
  guildNameCacheRef: React.MutableRefObject<Record<string, string>> | null;
  sessionToken?: string | null;
  /**
   * A chronicle day, or `null` for the live map. Non-null switches the
   * prosperity/infrastructure/trade/infestation path off `/compiled_data/provinces` and
   * `/province/{x},{y}/meta`, which are recomputed from today's state.
   * `province` mode is the exception: `/meta` reads provinces.png and
   * provinces.txt (static input), and `/data/county` is de jure structure,
   * so both stay live under a stored day.
   */
  day?: string | null;
  /**
   * Map pixel -> province id, resolved client-side from the quarter-scale
   * province id grid the chronicle already downloads. Only used on the day
   * path; the live path keeps the server's `/meta` lookup.
   */
  resolveProvinceId?: (x: number, y: number) => number | null;
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

  const capitalize = (v: string) => v[0].toUpperCase() + v.slice(1);

  const handleProvinceHover = (
    x: number,
    y: number,
    screenX: number,
    screenY: number
  ): boolean => {
    const active =
      mapType === "terrain" ||
      mapType === "fertility" ||
      mapType === "prosperity" ||
      mapType === "infrastructure" ||
      mapType === "infestation" ||
      mapType === "trade" ||
      mapType === "province";

    const consumesHover =
      mapType === "terrain" ||
      mapType === "fertility" ||
      mapType === "prosperity" ||
      mapType === "infrastructure" ||
      mapType === "infestation" ||
      mapType === "province";

    if (!active) return false;

    const render = (data: any) => {
      if (!data) return;
      if (data.terrain === "sea" || data.terrain === "water") {
        setCursorTooltip(null);
        return;
      }

      const lines = [`x: ${x}  z: ${y}`];

      if (mapType === "terrain")
        lines.push(`Terrain: ${capitalize(data.terrain)}`);
      if (mapType === "fertility") lines.push(`Fertility: ${data.fertility}`);
      if (mapType === "prosperity")
        lines.push(`Prosperity: ${data.prosperity ?? 0}`);
      if (mapType === "infrastructure") {
        const detail = infrastructureHoverText(data);
        if (detail) lines.push(detail);
      }
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

      setCursorTooltip({
        x: screenX,
        y: screenY,
        text: lines.join("\n"),
      });
    };

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

      return consumesHover;
    }

    if (day !== null) {
      // Stored day: province id comes from the grid already in memory, and the
      // province's own numbers come from that day's `province_data`. No live
      // request is issued from this path at all.
      const pid = resolveProvinceId?.(x, y) ?? null;
      if (!pid) return consumesHover;

      const key = `${mapId}:${day}`;
      const cached = dayCacheRef.current;
      if (cached?.key === key) {
        // Deferred to a microtask so the ordering matches the live map's.
        // For `trade` (and `prosperity`) `consumesHover` is false, so the
        // caller goes on to run region hover, which writes its own tooltip
        // *after* this one. Live, that race is won by this path because its
        // data arrives over the network; from a warm cache a synchronous
        // render would lose it, and the province breakdown would flash once
        // and never be seen again.
        queueMicrotask(() => render(cached.byId[pid]));
        return consumesHover;
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

      return consumesHover;
    }

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

    return consumesHover;
  };

  return { handleProvinceHover };
}

// hooks/useGuildCache.ts
import { useEffect, useRef } from "react";

import type { MapId } from "../components/map/types";
import { fetchGuildNameCache } from "@/app/lib/map/dataSource";

export function useGuildCache(
  mapId: MapId,
  sessionToken?: string | null,
  /**
   * A chronicle day, or `null` for the live map. `trade` is one of the six
   * captured sources, so a stored day has real guild names rather than today's.
   * Taken as a parameter, not read from context, so the call site shows it.
   */
  day: string | null = null,
) {
  // Null-prototype for the same reason `fetchGuildNameCache` builds one: this
  // ref is probed as `current[guildId]` with ids straight off the wire, and a
  // plain `{}` answers `constructor` or `toString` with an inherited function.
  const guildNameCacheRef = useRef<Record<string, string>>(Object.create(null));

  useEffect(() => {
    let cancelled = false;

    void fetchGuildNameCache({ mapId, day, sessionToken })
      .then((names) => {
        if (cancelled) return;
        guildNameCacheRef.current = names;
      })
      .catch(() => {
        // Unchanged from before: any failure — including a day that never
        // captured `trade`, which arrives as `ChronicleDayFileMissingError` —
        // leaves the cache empty and hover falls back to raw guild ids. A
        // missing name is cosmetic, so this stays silent rather than logging
        // once per day scrubbed past.
        if (!cancelled) {
          guildNameCacheRef.current = Object.create(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [mapId, sessionToken, day]);

  return guildNameCacheRef;
}

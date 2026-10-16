import { fetchMapJson } from "@/lib/map/api";
import type { MapId } from "@/app/components/map/types";

import { chronicleDiscardedProvinceMask } from "./chronicleWater";

/**
 * The live `/compiled_data/provinces` payload (~740KB: terrain, trade,
 * prosperity per province), fetched once per map and access context and
 * shared by every consumer — province-figure tooltips and trade picking's
 * terrain mask read the same body, and `fetchMapApi`'s no-cache policy would
 * otherwise transfer it once per consumer. Failures are evicted so a retry
 * really retries; the payload itself revalidates over HTTP on the next page.
 */
const compiledCache = new Map<string, Promise<Record<number, any>>>();

export function fetchCompiledProvinces(mapId: MapId, sessionToken?: string | null): Promise<Record<number, any>> {
  const key = `${mapId}\n${sessionToken ?? ""}`;
  const cached = compiledCache.get(key);
  if (cached) return cached;

  const pending = fetchMapJson<Record<number, any>>(`/${mapId}/compiled_data/provinces`, { sessionToken }).then(
    (all) => {
      // Reject before caching: a payload the terrain mask cannot trust
      // (not a province record, or entries without a readable terrain)
      // must not settle into the cache, or every retry would reuse it and
      // trade membership would treat it as "no water anywhere".
      if (chronicleDiscardedProvinceMask(all) === null) {
        throw new Error("Compiled provinces payload is not a readable province record");
      }
      return all;
    },
  );
  compiledCache.set(key, pending);
  pending.catch(() => {
    if (compiledCache.get(key) === pending) compiledCache.delete(key);
  });
  return pending;
}

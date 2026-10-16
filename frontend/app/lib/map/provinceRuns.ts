import { MapAccessError, fetchMapApi } from "@/lib/map/api";
import type { MapId } from "@/app/components/map/types";

import { decompressGzipBuffer } from "../labelBlobGeometry";
import { buildProvinceRunIndex, deserializeProvinceIdRuns, type ProvinceRunIndex } from "./editor/buildProvinceIndex";

/**
 * The public full-resolution province geometry: run-length province ids over
 * the whole map, the same artifact the editor reads through its staff-gated
 * sibling route. Geometry only — no ownership in it — so one decoded index
 * serves every map mode; membership comes from each mode's region data.
 */
export function provinceIdRunsPath(mapId: MapId): string {
  return `/${mapId}/data/province_id_runs`;
}

/**
 * In-flight and decoded indexes, by map and access context. A page keeps one
 * geometry per map for its life (the HTTP cache revalidates the artifact on
 * the next load, per the route's own freshness policy); a failed load is
 * evicted so a retry really retries.
 */
const indexCache = new Map<string, Promise<ProvinceRunIndex>>();

async function loadProvinceRunIndex(
  mapId: MapId,
  sessionToken: string | null | undefined,
  signal: AbortSignal | undefined,
): Promise<ProvinceRunIndex> {
  const path = provinceIdRunsPath(mapId);
  const res = await fetchMapApi(path, { sessionToken, signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText || "Request failed";
    throw new MapAccessError(detail, res.status, detail);
  }
  // `application/gzip` bypasses the server's gzip middleware, so the browser
  // hands the bytes through compressed (see chronicleData.fetchGzippedBytes).
  const payload = await decompressGzipBuffer(await res.arrayBuffer());
  const decoded = deserializeProvinceIdRuns(payload);
  return buildProvinceRunIndex(decoded.width, decoded.height, decoded.runLengths, decoded.runIds, decoded.bbox);
}

export function fetchProvinceRunIndex(
  mapId: MapId,
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<ProvinceRunIndex> {
  const key = `${mapId}\n${sessionToken ?? ""}`;
  const cached = indexCache.get(key);
  if (cached) return cached;

  const pending = loadProvinceRunIndex(mapId, sessionToken, signal);
  indexCache.set(key, pending);
  pending.catch(() => {
    if (indexCache.get(key) === pending) indexCache.delete(key);
  });
  return pending;
}

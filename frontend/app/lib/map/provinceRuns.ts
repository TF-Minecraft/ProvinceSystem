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

function abortError(): Error {
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError");
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

async function loadProvinceRunIndex(mapId: MapId, sessionToken: string | null | undefined): Promise<ProvinceRunIndex> {
  const path = provinceIdRunsPath(mapId);
  const res = await fetchMapApi(path, { sessionToken });
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

/**
 * The shared load outlives any one caller: it runs without a caller's abort
 * signal, and a caller's signal only detaches that caller. Aborting one
 * consumer must not reject concurrent consumers or the retry that replaces
 * it (a remount under React strict effects aborts and re-asks at once).
 */
export function fetchProvinceRunIndex(
  mapId: MapId,
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<ProvinceRunIndex> {
  if (signal?.aborted) return Promise.reject(abortError());

  const key = `${mapId}\n${sessionToken ?? ""}`;
  let shared = indexCache.get(key);
  if (!shared) {
    shared = loadProvinceRunIndex(mapId, sessionToken);
    indexCache.set(key, shared);
    shared.catch(() => {
      if (indexCache.get(key) === shared) indexCache.delete(key);
    });
  }
  if (!signal) return shared;

  return new Promise<ProvinceRunIndex>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(
      (index) => {
        signal.removeEventListener("abort", onAbort);
        resolve(index);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

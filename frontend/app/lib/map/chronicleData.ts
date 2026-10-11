import { MapAccessError, fetchMapApi, fetchMapJson } from "@/lib/map/api";
import type { MapId, MapMarkersResponse } from "@/app/components/map/types";

import { decompressGzipBuffer } from "../labelBlobGeometry";
import { deserializeProvinceIdGrid } from "./editor/buildProvinceIndex";
import type { ProvinceIdGrid } from "./chroniclePaint";

/**
 * The only names `/chronicle/{day}/data/{name}` serves. Single source so the
 * union below cannot drift away from the backend's list
 * (`CHRONICLE_FILES` in `backend/src/scripts/chronicle/store.py`).
 *
 * Title tiers `county`/`duchy`/`kingdom` are captured: players found titles
 * in-game, so a stored day must not paint today's de jure map. `empire` was
 * already day-varying. `infestation_data` is optional on the backend and
 * `main` has no such file at all today, so a 404 from it is a normal state
 * the missing-day-file panel already handles. Days captured before those
 * names existed simply have no entry; the read route 404s them.
 */
export const CHRONICLE_FILE_NAMES = [
  "nation",
  "province_data",
  "map_markers",
  "trade",
  "guilds",
  "zoc_overlays",
  "empire",
  "infestation_data",
  "county",
  "duchy",
  "kingdom",
] as const;

export type ChronicleFileName = (typeof CHRONICLE_FILE_NAMES)[number];

/** One day whose capture was missing or torn sources. */
export type ChronicleIncompleteDay = {
  day: string;
  missing: string[];
  invalid: string[];
};

export type ChronicleIndex = {
  /** UTC `YYYY-MM-DD`, ascending. Empty on a map with no history yet. */
  days: string[];
  first: string | null;
  last: string | null;
  /**
   * sha256 of the province geometry the snapshots were captured against. A
   * mismatch with the live map means provinces moved since, and old frames no
   * longer line up with today's grid. Null when the map has no
   * `province_id_runs.bin.gz` built yet, which is the state every map starts in.
   */
  geometry_version: string | null;
  incomplete_days: ChronicleIncompleteDay[];
  incomplete_day_count: number;
};

export function chronicleIndexPath(mapId: MapId): string {
  return `/${mapId}/chronicle/index`;
}

export function chronicleDayFilePath(mapId: MapId, day: string, name: ChronicleFileName): string {
  return `/${mapId}/chronicle/${encodeURIComponent(day)}/data/${name}`;
}

export function chronicleDayMarkersPath(mapId: MapId, day: string): string {
  return `/${mapId}/chronicle/${encodeURIComponent(day)}/markers`;
}

export function provinceIdGridQ4Path(mapId: MapId): string {
  return `/${mapId}/data/province_id_grid_q4`;
}

/**
 * A map with no history answers 200 with `days: []` and null bounds — day zero,
 * not an error. Callers render the empty timeline for it.
 */
export async function fetchChronicleIndex(mapId: MapId, sessionToken?: string | null): Promise<ChronicleIndex> {
  return fetchMapJson<ChronicleIndex>(chronicleIndexPath(mapId), {
    sessionToken,
  });
}

/**
 * A source that simply is not present for that day. Distinct from a transport
 * failure (which arrives as `MapAccessError` with status 0) because a hole in
 * one source is a normal, skippable state rather than something to retry.
 */
export class ChronicleDayFileMissingError extends MapAccessError {
  day: string;
  fileName: ChronicleFileName;

  constructor(day: string, fileName: ChronicleFileName, detail: string) {
    super(`Chronicle ${day}/${fileName} not found`, 404, detail);
    this.name = "ChronicleDayFileMissingError";
    this.day = day;
    this.fileName = fileName;
  }
}

export function isChronicleDayFileMissing(error: unknown): error is ChronicleDayFileMissingError {
  return error instanceof ChronicleDayFileMissingError;
}

export type ChronicleDayFile<T> = {
  value: T;
  /** Length of the decompressed JSON, before parsing. */
  byteLength: number;
  /** See `fingerprintBytes`. Equal fingerprints mean equal content. */
  fingerprint: string;
};

/**
 * Content hash of the *decompressed* bytes, used by the studio to notice that a
 * day is identical to the one before it and reuse the painted frame instead of
 * repainting ~2.5M pixels.
 *
 * Length alone is not sound — two days with the same nations but swapped
 * province ownership are byte-for-byte the same size. Hashing the compressed
 * bytes is not sound either, since gzip headers carry an mtime that changes
 * even when the payload does not. So: one pass over the plain bytes with two
 * independent 32-bit lanes (FNV-1a and a mixed multiply), reported together
 * with the length. That is ~2^-64 collision odds across a year of days for the
 * cost of a single linear scan, no crypto and no async.
 */
export function fingerprintBytes(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b, 0x85ebca6b) >>> 0;
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
  }
  const lanes = `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
  return `${bytes.length.toString(16)}-${lanes}`;
}

/**
 * A day file is 4.6 KB decompressed on a real map, and the build gunzips six of
 * them at once. `decompressGzipBuffer` buffers whatever the stream produces, so
 * without a cap a single crafted or corrupt response takes the tab with it — and
 * takes it during a build the user cannot cancel out of. Generous enough that no
 * real day comes near it, small enough that six concurrent worst cases still fit.
 */
export const CHRONICLE_DAY_FILE_BUDGET_BYTES = 8 * 1024 * 1024;

/**
 * The q4 grid is genuinely large: 1600x1600 `Uint16` is 5.1 MB plus the header,
 * and it is fetched once per session rather than once per day.
 */
export const CHRONICLE_GRID_BUDGET_BYTES = 32 * 1024 * 1024;

export class ChronicleDecompressionLimitError extends MapAccessError {
  constructor(path: string, limitBytes: number) {
    const detail = `${path} expands past the ${limitBytes} byte chronicle limit`;
    super(detail, 0, detail);
    this.name = "ChronicleDecompressionLimitError";
  }
}

/**
 * Same job as `decompressGzipBuffer`, but reads the stream in chunks and gives
 * up the moment the running total passes `limitBytes` instead of buffering the
 * whole thing first. Kept local to the chronicle so the shared helper's other
 * callers keep their existing behaviour.
 */
async function decompressGzipWithBudget(
  compressed: ArrayBuffer,
  limitBytes: number,
  path: string,
): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    // Fall back to the shared helper, which throws its own clear message.
    return decompressGzipBuffer(compressed);
  }

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limitBytes) {
        throw new ChronicleDecompressionLimitError(path, limitBytes);
      }
      chunks.push(value);
    }
  } finally {
    // Releases the underlying source whether we finished or bailed out.
    await reader.cancel().catch(() => {});
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

async function fetchGzippedBytes(
  path: string,
  sessionToken: string | null | undefined,
  onNotFound: (detail: string) => Error,
  signal: AbortSignal | undefined,
  limitBytes: number,
): Promise<ArrayBuffer> {
  const res = await fetchMapApi(path, { sessionToken, signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText || "Request failed";
    if (res.status === 404) throw onNotFound(detail);
    throw new MapAccessError(detail, res.status, detail);
  }
  // `application/gzip` is excluded from the server's gzip middleware, so the
  // browser hands these through compressed and we gunzip them ourselves.
  return decompressGzipWithBudget(await res.arrayBuffer(), limitBytes, path);
}

export async function fetchChronicleDayFile<T>(
  mapId: MapId,
  day: string,
  name: ChronicleFileName,
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<ChronicleDayFile<T>> {
  const buffer = await fetchGzippedBytes(
    chronicleDayFilePath(mapId, day, name),
    sessionToken,
    (detail) => new ChronicleDayFileMissingError(day, name, detail),
    signal,
    CHRONICLE_DAY_FILE_BUDGET_BYTES,
  );
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8").decode(bytes);
  return {
    value: JSON.parse(text) as T,
    byteLength: bytes.length,
    fingerprint: fingerprintBytes(bytes),
  };
}

/**
 * One stored day's markers, in the same shape as `/{map}/data/markers` — the
 * studio feeds them straight to the live map's marker and war layers.
 *
 * Read as text rather than `res.json()` so the payload's size is known: the
 * studio's build estimate is measured from the bytes it has already pulled, and
 * this route is plain (server-gzipped) JSON with no length it can otherwise
 * trust. The count is JS string length, which equals the byte count for the
 * ASCII this payload is made of and is close enough for an estimate otherwise.
 */
export async function fetchChronicleDayMarkers(
  mapId: MapId,
  day: string,
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<Omit<ChronicleDayFile<MapMarkersResponse>, "fingerprint">> {
  const path = chronicleDayMarkersPath(mapId, day);
  const res = await fetchMapApi(path, { sessionToken, signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText || "Request failed";
    if (res.status === 404) {
      throw new ChronicleDayFileMissingError(day, "map_markers", detail);
    }
    throw new MapAccessError(detail, res.status, detail);
  }

  const text = await res.text();
  return {
    value: JSON.parse(text) as MapMarkersResponse,
    byteLength: text.length,
  };
}

/**
 * The quarter-scale grid every chronicle frame is painted from: ~95 KB on the
 * wire against 353 KB for the full-resolution run index, and it is fetched once
 * for a whole timelapse.
 */
export async function fetchProvinceIdGridQ4(
  mapId: MapId,
  sessionToken?: string | null,
  signal?: AbortSignal,
): Promise<ProvinceIdGrid> {
  const buffer = await fetchGzippedBytes(
    provinceIdGridQ4Path(mapId),
    sessionToken,
    (detail) => new MapAccessError(detail, 404, detail),
    signal,
    CHRONICLE_GRID_BUDGET_BYTES,
  );
  return deserializeProvinceIdGrid(buffer);
}

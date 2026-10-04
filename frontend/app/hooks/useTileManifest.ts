"use client";

import { useCallback, useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import { fetchMapJson, mapApiUrl } from "@/lib/map/api";
import {
  isTileManifest,
  type TileManifest,
} from "@/app/lib/map/tilePyramid";

/**
 * Manifests already fetched this page view, by `mapId/layer`. Switching back
 * to a mode whose preview the layers panel loaded needs no round trip
 * before its tiles can start.
 */
const manifestCache = new Map<string, TileManifest>();

function cacheKey(mapId: MapId, layer: string): string {
  return `${mapId}/${layer}`;
}

async function fetchManifest(mapId: MapId, layer: string): Promise<TileManifest | null> {
  const body = await fetchMapJson<unknown>(
    `/${mapId}/tiles/${encodeURIComponent(layer)}/manifest`
  );
  if (!isTileManifest(body)) return null;
  manifestCache.set(cacheKey(mapId, layer), body);
  return body;
}

export function tileUrl(
  mapId: MapId,
  layer: string,
  manifest: TileManifest,
  level: number,
  x: number,
  y: number
): string {
  return mapApiUrl(
    `/${mapId}/tiles/${encodeURIComponent(layer)}/${manifest.version}/${level}/${x}/${y}.webp`
  );
}

/** How long to wait before asking again while the backend builds the pyramid. */
const NOT_READY_RETRY_MS = 5_000;
const MAX_ATTEMPTS = 24;

/**
 * - `loading`: the first answer has not arrived yet
 * - `building`: the backend is still making the pyramid; draw the fallback
 * - `ready`: `manifest` is set
 * - `unavailable`: no tiles for this layer (or tiles are off); draw the fallback
 */
export type TileManifestStatus = "loading" | "building" | "ready" | "unavailable";

export type TileManifestState = {
  manifest: TileManifest | null;
  status: TileManifestStatus;
  /** Ask again, e.g. after a tile 404s because the pyramid was replaced. */
  refresh: () => void;
};

/**
 * The tile pyramid for one of a map's tiled layers (`base`, `mapdata-{mode}`,
 * `regions-{mode}`). Every failure degrades to the caller's single-image
 * fallback, which is how the map worked before tiles.
 *
 * Only for maps a plain `<img>` can load. Staff maps need a bearer token per
 * request, and fetching hundreds of tiles as blobs would cost more than the
 * single image it replaces, so callers keep those on the single image.
 */
export function useTileManifest(
  mapId: MapId,
  layer: string | null,
  enabled: boolean
): TileManifestState {
  const [manifest, setManifest] = useState<TileManifest | null>(null);
  const [status, setStatus] = useState<TileManifestStatus>("loading");
  /** Which `mapId/layer` the two states above describe. */
  const [stateKey, setStateKey] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const key = enabled && layer ? cacheKey(mapId, layer) : null;

  const refresh = useCallback(() => {
    if (layer) manifestCache.delete(cacheKey(mapId, layer));
    setGeneration((value) => value + 1);
  }, [mapId, layer]);

  useEffect(() => {
    setStateKey(key);
    if (!enabled || !layer) {
      setManifest(null);
      setStatus("unavailable");
      return;
    }
    const cached = manifestCache.get(cacheKey(mapId, layer));
    if (cached) {
      setManifest(cached);
      setStatus("ready");
      return;
    }
    setManifest(null);
    setStatus("loading");

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const load = () => {
      attempts += 1;
      void fetchManifest(mapId, layer)
        .then((body) => {
          if (cancelled) return;
          if (body) {
            setManifest(body);
            setStatus("ready");
          } else if (attempts < MAX_ATTEMPTS) {
            setStatus("building");
            timer = setTimeout(load, NOT_READY_RETRY_MS);
          } else {
            setStatus("unavailable");
          }
        })
        .catch(() => {
          // No tiles for this layer (or an older backend): the fallback stays.
          if (!cancelled) setStatus("unavailable");
        });
    };
    load();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [mapId, layer, enabled, generation, key]);

  // Right after the layer changes, the state still describes the previous
  // one until the effect runs. Answer for the new layer straight away, from
  // the cache when it can, so nobody builds the new layer's tile URLs out of
  // the old layer's version.
  if (!key) return { manifest: null, status: "unavailable", refresh };
  if (stateKey !== key) {
    const cached = manifestCache.get(key);
    return { manifest: cached ?? null, status: cached ? "ready" : "loading", refresh };
  }
  return { manifest, status, refresh };
}

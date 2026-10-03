"use client";

import { useCallback, useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import { fetchMapJson } from "@/lib/map/api";
import { isTileManifest, type TileManifest } from "@/app/lib/map/tilePyramid";

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
  const [generation, setGeneration] = useState(0);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    setManifest(null);
    if (!enabled || !layer) {
      setStatus("unavailable");
      return;
    }
    setStatus("loading");

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const load = () => {
      attempts += 1;
      void fetchMapJson<unknown>(
        `/${mapId}/tiles/${encodeURIComponent(layer)}/manifest`
      )
        .then((body) => {
          if (cancelled) return;
          if (isTileManifest(body)) {
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
  }, [mapId, layer, enabled, generation]);

  return { manifest, status, refresh };
}

"use client";

import { useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import { fetchMapJson } from "@/lib/map/api";
import { isTileManifest, type TileManifest } from "@/app/lib/map/tilePyramid";

/** How long to wait before asking again while the backend builds the pyramid. */
const NOT_READY_RETRY_MS = 15_000;
const MAX_ATTEMPTS = 8;

/**
 * The tile pyramid for one of a map's full-size rasters (`base`, or
 * `mapdata-{mode}`), or null while there is none to use: still being built,
 * not available, or `enabled` is off. Null means "draw the single image", so
 * every failure here degrades to how the map worked before tiles.
 *
 * Only for maps a plain `<img>` can load. Staff maps need a bearer token per
 * request, and fetching hundreds of tiles as blobs would cost more than the
 * single image it replaces, so callers keep those on the single image.
 */
export function useTileManifest(
  mapId: MapId,
  layer: string | null,
  enabled: boolean
): TileManifest | null {
  const [manifest, setManifest] = useState<TileManifest | null>(null);

  useEffect(() => {
    setManifest(null);
    if (!enabled || !layer) return;

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
          } else if (attempts < MAX_ATTEMPTS) {
            timer = setTimeout(load, NOT_READY_RETRY_MS);
          }
        })
        .catch(() => {
          // No tiles for this layer (or an older backend): the single image
          // stays in use.
        });
    };
    load();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [mapId, layer, enabled]);

  return manifest;
}

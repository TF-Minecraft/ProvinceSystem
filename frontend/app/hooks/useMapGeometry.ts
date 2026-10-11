import { useEffect, useState } from "react";

import {
  decompressGzipBuffer,
  parseProvinceLabelGrid,
  type ProvinceLabelGrid,
  type ProvinceLabelGridMeta,
} from "../lib/labelBlobGeometry";
import type { ProvinceCentroids, ProvinceNeighbors } from "../lib/mapLabels";
import { fetchMapApi } from "@/lib/map/api";
import type { MapId } from "../components/map/types";

export type MapGeometryState = {
  neighbors: ProvinceNeighbors | null;
  labelNeighbors: ProvinceNeighbors | null;
  centroids: ProvinceCentroids | null;
  labelGrid: ProvinceLabelGrid | null;
  ready: boolean;
};

export function mapGeometryDataPaths(mapId: MapId): string[] {
  return [
    `/${mapId}/data/province_neighbors`,
    `/${mapId}/data/province_label_neighbors`,
    `/${mapId}/data/province_centroids`,
    `/${mapId}/data/province_label_grid`,
    `/${mapId}/data/province_label_grid_bin`,
  ];
}

/**
 * While geometry is still loading, treat names as supported so a names-on
 * build hits "still loading" rather than "this map has no geometry". After
 * ready, names need both neighbor and centroid files.
 */
export function chronicleNamesSupported(geometry: { ready: boolean; neighbors: unknown; centroids: unknown }): boolean {
  if (!geometry.ready) return true;
  return Boolean(geometry.neighbors && geometry.centroids);
}

const EMPTY_GEOMETRY: MapGeometryState = {
  neighbors: null,
  labelNeighbors: null,
  centroids: null,
  labelGrid: null,
  ready: false,
};

export function useMapGeometry(mapId: MapId, sessionToken?: string | null): MapGeometryState {
  const [state, setState] = useState<MapGeometryState>(EMPTY_GEOMETRY);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState({
        neighbors: null,
        labelNeighbors: null,
        centroids: null,
        labelGrid: null,
        ready: false,
      });

      try {
        const [neighborsRes, labelNeighborsRes, centroidsRes, gridMetaRes, gridBinRes] = await Promise.all(
          mapGeometryDataPaths(mapId).map((path) => fetchMapApi(path, { sessionToken })),
        );

        if (!neighborsRes.ok || !centroidsRes.ok) {
          throw new Error("Failed to fetch map geometry");
        }

        const [neighbors, centroids] = await Promise.all([
          neighborsRes.json() as Promise<ProvinceNeighbors>,
          centroidsRes.json() as Promise<ProvinceCentroids>,
        ]);

        let labelNeighbors: ProvinceNeighbors = neighbors;
        if (labelNeighborsRes.ok) {
          labelNeighbors = (await labelNeighborsRes.json()) as ProvinceNeighbors;
        }

        let labelGrid: ProvinceLabelGrid | null = null;
        if (gridMetaRes.ok && gridBinRes.ok) {
          const meta = (await gridMetaRes.json()) as ProvinceLabelGridMeta;
          const compressed = await gridBinRes.arrayBuffer();
          const buffer = await decompressGzipBuffer(compressed);
          labelGrid = parseProvinceLabelGrid(meta, buffer);
        }

        if (cancelled) return;

        setState({
          neighbors,
          labelNeighbors,
          centroids,
          labelGrid,
          ready: true,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("Error fetching map geometry:", err);
        setState({
          neighbors: null,
          labelNeighbors: null,
          centroids: null,
          labelGrid: null,
          ready: true,
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [mapId, sessionToken]);

  return state;
}

// core/MapEngineContext.tsx
"use client";

import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { MapObject, OverlayBBox } from "../components/map/types";
import { apiBase } from "../components/map/types";
import {
  buildMapObjectIndex,
  buildMapObjectsFromRegionData,
  initialMapObjectVisibility,
  resolveHoverTarget,
} from "./mapObjectBuilder";

type HoverRegionResult = {
  regionId: string | null;
  imagePath: string | null;
  region: Record<string, unknown> | null;
  overlay?: OverlayBBox;
};

type MapEngineContextType = {
  mapObjects: ReturnType<typeof buildMapObjectsFromRegionData>;
  loadData: (regionData: Record<string, unknown>) => void;
  resetDrillVisibility: (regionData: Record<string, unknown>) => void;
  resetMapObjects: () => void;
  getHoverRegion: (
    mapType: string,
    mapId: string,
    regionId: string,
    regionData: Record<string, unknown>,
  ) => HoverRegionResult;
  drillDownRegion: (regionId: string, regionData: Record<string, unknown>) => void;
};

const MapEngineContext = createContext<MapEngineContextType | undefined>(undefined);

export const MapEngineProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mapObjects, setMapObjects] = useState<ReturnType<typeof buildMapObjectsFromRegionData>>([]);
  const mapObjectsRef = useRef(mapObjects);
  mapObjectsRef.current = mapObjects;

  /**
   * `mapObjects` keyed for lookup. `getHoverRegion` walks the overlord chain
   * and previously ran two `objects.find(...)` scans per step, which is O(N)
   * per lookup and quadratic over a deep chain. Rebuilt whenever `mapObjects`
   * changes so it can never disagree with `mapObjectsRef`.
   *
   * Entries are keyed by `baseId` in two buckets rather than by `id`, because
   * `id` mixes real region ids with synthetic `${id}_nested` ids and the two
   * namespaces can collide (see `MapObject`).
   */
  const mapObjectIndex = useMemo(() => buildMapObjectIndex(mapObjects), [mapObjects]);
  const mapObjectIndexRef = useRef(mapObjectIndex);
  mapObjectIndexRef.current = mapObjectIndex;

  const loadData = useCallback((regionData: Record<string, unknown>) => {
    const next = buildMapObjectsFromRegionData(regionData);
    setMapObjects((prev) => {
      if (prev.length === 0 && next.length === 0) return prev;
      return next;
    });
  }, []);

  const resetDrillVisibility = useCallback((regionData: Record<string, unknown>) => {
    setMapObjects((prev) =>
      prev.map((obj) => ({
        ...obj,
        visible: initialMapObjectVisibility(obj, regionData),
      })),
    );
  }, []);

  const resetMapObjects = useCallback(() => {
    setMapObjects((prev) => (prev.length === 0 ? prev : []));
  }, []);

  const getHoverRegion = useCallback(
    (mapType: string, mapId: string, regionId: string, regionData: Record<string, unknown>): HoverRegionResult => {
      // The walk itself (with its cycle guard and O(1) lookups) lives in
      // `mapObjectBuilder` so it is a pure function the `node` test suite can
      // cover; this only turns the resolved entry into a URL.
      const target = resolveHoverTarget(regionId, regionData, mapObjectIndexRef.current);
      if (!target) return { regionId: null, imagePath: null, region: null };

      const base = apiBase();
      return {
        regionId: target.regionId,
        imagePath: `${base}/${mapId}/regions/${mapType}/${target.object.path}_hover`,
        region: target.region,
        overlay: target.object.overlay,
      };
    },
    [],
  );

  const drillDownRegion = useCallback((regionId: string, regionData: Record<string, unknown>) => {
    setMapObjects((prev) => {
      const region = regionData[regionId] as Record<string, unknown>;
      const subjects = region?.subjects as string[] | undefined;
      if (!region || !subjects?.length) return prev;

      const updated = prev.map((obj) => ({ ...obj }));
      // Matched on the recorded structure, not on the id string: a real
      // region named `${something}_nested` would otherwise be mistaken for
      // the synthetic drill entry of `something`.
      const isBase = (obj: MapObject, id: string) => obj.nested !== true && (obj.baseId ?? obj.id) === id;

      const mainIndex = updated.findIndex((obj) => isBase(obj, regionId));
      if (mainIndex !== -1) updated[mainIndex].visible = false;

      const nestedIndex = updated.findIndex((obj) => obj.nested === true && (obj.baseId ?? obj.id) === regionId);
      if (nestedIndex !== -1) updated[nestedIndex].visible = true;

      for (const subjectId of subjects) {
        const subjectIndex = updated.findIndex((obj) => isBase(obj, subjectId));
        if (subjectIndex !== -1) updated[subjectIndex].visible = true;
      }

      return updated;
    });
  }, []);

  const value = useMemo(
    () => ({
      mapObjects,
      loadData,
      resetDrillVisibility,
      resetMapObjects,
      getHoverRegion,
      drillDownRegion,
    }),
    [mapObjects, loadData, resetDrillVisibility, resetMapObjects, getHoverRegion, drillDownRegion],
  );

  return <MapEngineContext.Provider value={value}>{children}</MapEngineContext.Provider>;
};

export const useMapEngine = () => {
  const context = useContext(MapEngineContext);
  if (!context) throw new Error("useMapEngine must be used inside a MapEngineProvider");
  return context;
};

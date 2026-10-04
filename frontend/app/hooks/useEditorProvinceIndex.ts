"use client";

import { useEffect, useRef, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import {
  buildProvinceIndexFromGrid,
  buildProvinceIndexFromRuns,
  buildProvinceRunIndex,
  deserializeProvinceIdGrid,
  deserializeProvinceIdRuns,
  type ProvinceIndex,
} from "@/app/lib/map/editor/buildProvinceIndex";
import {
  fetchEditorProvinces,
  fetchEditorProvinceIndex,
  fetchMapApi,
  MapAccessError,
  type EditorProvinceRow,
} from "@/lib/map/api";

async function gunzipProvinceIndexGrid(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("gzip decompression not supported");
  }
  const stream = new Blob([buffer])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/**
 * Feature flag for the run-length province index.
 *
 * Defaults to OFF: unless this is exactly "1" the editor keeps using the flat
 * province_id_grid path, byte for byte. Even when it is on, a missing route, a
 * stale or corrupt artifact, or any decoder failure falls back to the flat
 * path rather than failing the editor.
 */
export function isEditorProvinceRunsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_EDITOR_PROVINCE_RUNS === "1";
}

export function editorProvinceRunsPath(mapId: MapId): string {
  return `/${mapId}/editor/province-runs`;
}

/**
 * Try the runs artifact. Returns null (never throws) whenever the runs path
 * is unavailable for any reason, so the caller can use the flat path.
 */
export async function loadProvinceIndexFromRuns(
  mapId: MapId,
  sessionToken: string,
  provinces: EditorProvinceRow[]
): Promise<ProvinceIndex | null> {
  try {
    const res = await fetchMapApi(editorProvinceRunsPath(mapId), {
      sessionToken,
    });
    if (!res.ok) return null;

    const payload = await gunzipProvinceIndexGrid(await res.arrayBuffer());
    const decoded = deserializeProvinceIdRuns(payload);
    const runIndex = buildProvinceRunIndex(
      decoded.width,
      decoded.height,
      decoded.runLengths,
      decoded.runIds,
      decoded.bbox
    );
    return buildProvinceIndexFromRuns(provinces, runIndex);
  } catch {
    return null;
  }
}

function loadErrorMessage(err: unknown): string {
  if (err instanceof MapAccessError) {
    return err.detail || err.message;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Failed to load province index";
}

export type EditorProvinceIndexCallbacks = {
  onCatalogLoaded?: () => void;
  onIndexLoaded?: () => void;
};

export function useEditorProvinceIndex(
  mapId: MapId,
  sessionToken: string | null,
  enabled = true,
  callbacks?: EditorProvinceIndexCallbacks
): {
  index: ProvinceIndex | null;
  loading: boolean;
  error: string | null;
} {
  const [index, setIndex] = useState<ProvinceIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const callbacksRef = useRef(callbacks);

  callbacksRef.current = callbacks;

  useEffect(() => {
    if (!enabled || !sessionToken) {
      setIndex(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setIndex(null);

      try {
        const runsEnabled = isEditorProvinceRunsEnabled();
        const provincesPromise = fetchEditorProvinces(mapId, sessionToken);
        // Only prefetch the 82 MB grid when the flat path is the one we will
        // actually use; the runs path must not pay for it.
        const gridPromise = runsEnabled
          ? null
          : fetchEditorProvinceIndex(mapId, sessionToken);

        const { provinces } = await provincesPromise;
        if (cancelled) return;
        callbacksRef.current?.onCatalogLoaded?.();

        let built: ProvinceIndex | null = null;

        if (runsEnabled) {
          built = await loadProvinceIndexFromRuns(
            mapId,
            sessionToken,
            provinces
          );
          if (cancelled) return;
        }

        if (!built) {
          // Use the flat grid when runs are disabled, absent, stale or undecodable.
          const gridBytes = await (gridPromise ??
            fetchEditorProvinceIndex(mapId, sessionToken));
          if (cancelled) return;

          const payload = await gunzipProvinceIndexGrid(gridBytes);
          const { width, height, ids } = deserializeProvinceIdGrid(payload);
          built = buildProvinceIndexFromGrid(provinces, width, height, ids);
        }

        if (!cancelled) {
          setIndex(built);
          setLoading(false);
          callbacksRef.current?.onIndexLoaded?.();
        }
      } catch (err) {
        if (!cancelled) {
          setIndex(null);
          setLoading(false);
          setError(loadErrorMessage(err));
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [mapId, sessionToken, enabled]);

  return { index, loading, error };
}

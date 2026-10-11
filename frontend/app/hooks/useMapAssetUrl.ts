"use client";

import { useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import { useAccessibleMaps } from "./useAccessibleMaps";
import { fetchMapBlobUrl, mapApiUrl, mapRequiresAuth, revokeMapBlobUrl } from "@/lib/map/api";

type UseMapAssetUrlResult = {
  url: string | null;
  loading: boolean;
  error: string | null;
};

export function useMapAssetUrl(
  mapId: MapId,
  path: string,
  sessionToken: string | null | undefined,
  enabled = true,
): UseMapAssetUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { maps } = useAccessibleMaps();

  useEffect(() => {
    if (!enabled || !path) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    const directUrl = mapApiUrl(path);
    const needsAuth = mapRequiresAuth(mapId, maps);
    const token = (sessionToken || "").trim();

    if (!needsAuth) {
      setUrl(directUrl);
      setLoading(false);
      setError(null);
      return;
    }

    if (!token) {
      setUrl(null);
      setLoading(false);
      setError("Authentication required");
      return;
    }

    let cancelled = false;
    let blobUrl: string | null = null;
    setLoading(true);
    setError(null);
    setUrl(null);

    void fetchMapBlobUrl(path, token)
      .then((nextUrl) => {
        if (cancelled) {
          revokeMapBlobUrl(nextUrl);
          return;
        }
        blobUrl = nextUrl;
        setUrl(nextUrl);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load map asset";
        setError(message);
        setUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      revokeMapBlobUrl(blobUrl);
    };
  }, [mapId, path, sessionToken, enabled, maps]);

  return { url, loading, error };
}

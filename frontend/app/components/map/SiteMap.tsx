"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { MapEngineProvider } from "@/app/core/MapEngineContext";
import MapViewer from "@/app/components/MapViewer";
import { useAccessibleMaps } from "@/app/hooks/useAccessibleMaps";
import { liveMapIdFrom, setLiveMapId } from "@/app/lib/map/chronicleDayRoute";

import type { MapId } from "./types";

function Loading() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)]">
      <p className="text-lg font-medium text-[var(--tfmc-cream)]">Loading map…</p>
    </div>
  );
}

/**
 * A map page, given either a map id from the URL or, for `/map`, nothing: the
 * site's live map. Which map that is comes from the backend's map list (`live`
 * in its registry), so the dev site can show the Dev server's map at `/map`
 * while the public site shows `main`. A URL naming the live map by id
 * forwards to `/map`, the one address for it.
 */
export default function SiteMap({ mapId }: { mapId?: MapId }) {
  const { maps, loading } = useAccessibleMaps();
  const router = useRouter();
  const liveId = loading ? null : liveMapIdFrom(maps);

  useEffect(() => {
    if (liveId) setLiveMapId(liveId);
  }, [liveId]);

  const forwardToLive = mapId !== undefined && liveId !== null && mapId === liveId;
  useEffect(() => {
    if (forwardToLive) router.replace(`/map${window.location.search}`);
  }, [forwardToLive, router]);

  if (liveId === null || forwardToLive) return <Loading />;

  const shown = mapId ?? liveId;
  return (
    <MapEngineProvider key={shown}>
      <MapViewer mapId={shown} />
    </MapEngineProvider>
  );
}

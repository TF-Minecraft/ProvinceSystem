"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import MapAccessGate, { type MapAccessGateReason } from "@/app/components/map/MapAccessGate";
import EditorDisabledGate from "@/app/components/map/editor/EditorDisabledGate";
import EditorEntryGate from "@/app/components/map/editor/EditorEntryGate";
import MapTitleEditor from "@/app/components/map/editor/MapTitleEditor";
import { MapSkeleton } from "@/app/components/shared/LoadingSkeleton";
import { useCharacterSessionToken } from "@/app/hooks/useCharacterSessionToken";
import { MapAccessError, fetchEditorProvinces, staffMapAccessReason } from "@/lib/map/api";
import { parseEditorTierParam, parseRequiredEditorMapIdParam } from "@/lib/map/editorParams";
import { isMapEditorEnabled } from "@/lib/map/editorAccess";

export default function MapEditorPageClient() {
  const searchParams = useSearchParams();
  const sessionToken = useCharacterSessionToken();
  const [gateReason, setGateReason] = useState<MapAccessGateReason | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);

  const mapId = parseRequiredEditorMapIdParam(searchParams.get("map"));
  const initialTier = parseEditorTierParam(searchParams.get("tier"));
  const editorEnabled = isMapEditorEnabled();

  useEffect(() => {
    if (!editorEnabled) {
      return;
    }

    if (!mapId) {
      setGateReason(null);
      setAccessChecked(true);
      return;
    }

    if (!sessionToken) {
      setGateReason("login");
      setAccessChecked(true);
      return;
    }

    let cancelled = false;
    setAccessChecked(false);
    setGateReason(null);

    void fetchEditorProvinces(mapId, sessionToken)
      .then(() => {
        if (!cancelled) setGateReason(null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof MapAccessError && err.status === 403) {
          setGateReason(staffMapAccessReason(err));
        } else {
          setGateReason("unknown");
        }
      })
      .finally(() => {
        if (!cancelled) setAccessChecked(true);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionToken, mapId, editorEnabled]);

  if (!editorEnabled) {
    return <EditorDisabledGate />;
  }

  if (!mapId) {
    return <EditorEntryGate />;
  }

  if (!accessChecked) {
    return <MapSkeleton label="Checking editor access…" />;
  }

  if (gateReason) {
    return <MapAccessGate reason={gateReason} mapDisplayName="the map editor" />;
  }

  if (!sessionToken) {
    return <MapAccessGate reason="login" mapDisplayName="the map editor" />;
  }

  return <MapTitleEditor mapId={mapId} initialTier={initialTier} sessionToken={sessionToken} />;
}

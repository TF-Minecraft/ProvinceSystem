"use client";

import { useCallback, useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import { isCharacterUiDev } from "@/lib/characters/uiDev";
import { isMapEditorEnabled, probeCanEditMap } from "@/lib/map/editorAccess";

type CanEditMapState = {
  canEdit: boolean;
  loading: boolean;
};

export function useCanEditMap(mapId: MapId, sessionToken: string | null): CanEditMapState {
  const [state, setState] = useState<CanEditMapState>(() => {
    if (!isMapEditorEnabled()) {
      return { canEdit: false, loading: false };
    }
    if (isCharacterUiDev()) {
      return { canEdit: true, loading: false };
    }
    return { canEdit: false, loading: Boolean(sessionToken) };
  });

  const load = useCallback(async () => {
    if (!isMapEditorEnabled()) {
      setState({ canEdit: false, loading: false });
      return;
    }

    if (isCharacterUiDev()) {
      setState({ canEdit: true, loading: false });
      return;
    }

    const token = sessionToken?.trim() ?? "";
    if (!token) {
      setState({ canEdit: false, loading: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true }));
    try {
      const canEdit = await probeCanEditMap(mapId, token);
      setState({ canEdit, loading: false });
    } catch {
      setState({ canEdit: false, loading: false });
    }
  }, [mapId, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "tfmc_character_session") {
        void load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  return state;
}

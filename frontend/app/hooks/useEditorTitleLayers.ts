"use client";

import { useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import type { TitleLayers } from "@/app/lib/titleProvinces";
import type { EditorTier } from "@/lib/map/api";
import { fetchMapJson } from "@/lib/map/api";

function draftToLayer(draft: TitleDraft): Record<string, { provinces?: number[]; titles?: string[] }> {
  const layer: Record<string, { provinces?: number[]; titles?: string[] }> = {};
  for (const [id, entry] of Object.entries(draft)) {
    layer[id] = {
      provinces: entry.provinces,
      titles: entry.titles,
    };
  }
  return layer;
}

export function useEditorTitleLayers(
  mapId: MapId,
  sessionToken: string | null,
  layersNeeded: EditorTier[],
  enabled = true,
): {
  titleLayers: TitleLayers;
  loading: boolean;
  error: string | null;
} {
  const [titleLayers, setTitleLayers] = useState<TitleLayers>({ county: {} });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionToken || layersNeeded.length === 0) {
      setTitleLayers({ county: {} });
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const layers: TitleLayers = { county: {} };

        for (const tier of layersNeeded) {
          const data = await fetchMapJson<TitleDraft>(`/${mapId}/data/${tier}`, { sessionToken });
          if (tier === "county") {
            layers.county = draftToLayer(data);
          } else if (tier === "duchy") {
            layers.duchy = draftToLayer(data);
          } else if (tier === "kingdom") {
            layers.kingdom = draftToLayer(data);
          } else if (tier === "empire") {
            layers.empire = draftToLayer(data);
          }
        }

        if (!cancelled) {
          setTitleLayers(layers);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setTitleLayers({ county: {} });
          setLoading(false);
          setError(err instanceof Error ? err.message : "Failed to load title layers");
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [mapId, sessionToken, enabled, layersNeeded.join(",")]);

  return { titleLayers, loading, error };
}

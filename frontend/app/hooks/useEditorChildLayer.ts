"use client";

import { useEffect, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import type { EditorTier } from "@/lib/map/api";
import { fetchMapJson } from "@/lib/map/api";

export function useEditorChildLayer(
  mapId: MapId,
  sessionToken: string | null,
  childTier: EditorTier | null,
  enabled = true,
): {
  childDraft: TitleDraft;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
} {
  const [childDraft, setChildDraft] = useState<TitleDraft>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !sessionToken || !childTier) {
      setChildDraft({});
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchMapJson<TitleDraft>(`/${mapId}/data/${childTier}`, { sessionToken });
        if (!cancelled) {
          setChildDraft(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setChildDraft({});
          setLoading(false);
          setError(err instanceof Error ? err.message : `Failed to load ${childTier} data`);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [mapId, sessionToken, childTier, enabled]);

  const isEmpty = Object.keys(childDraft).length === 0;

  return { childDraft, loading, error, isEmpty };
}

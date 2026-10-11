"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import { toggleProvinceInCounty, type ToggleProvinceOptions } from "@/app/lib/map/editor/countyDraftActions";
import {
  removeTitleFromDraft,
  toggleChildInParent,
  type ToggleChildInParentOptions,
} from "@/app/lib/map/editor/childTitleDraftActions";
import { type EditorTier, fetchMapJson } from "@/lib/map/api";

import { EDITOR_TITLE_TIERS } from "@/app/lib/map/editor/editorTiers";

export type EditorTitleEntry = {
  name: string;
  rgb: string;
  provinces?: number[];
  titles?: string[];
};

export type TitleDraft = Record<string, EditorTitleEntry>;

const EDITOR_TIERS = EDITOR_TITLE_TIERS;

type TierDraftMap = Record<EditorTier, TitleDraft | null>;

function emptyTierDraftMap(): TierDraftMap {
  return {
    county: null,
    duchy: null,
    kingdom: null,
    empire: null,
  };
}

function cloneDraft(data: TitleDraft): TitleDraft {
  return JSON.parse(JSON.stringify(data)) as TitleDraft;
}

function confirmDiscard(): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm("Discard unsaved changes?");
}

export function useEditorDraft({
  mapId,
  initialTier,
  sessionToken,
}: {
  mapId: MapId;
  initialTier: EditorTier;
  sessionToken: string | null;
}) {
  const [tier, setTierState] = useState<EditorTier>(initialTier);
  const [draft, setDraft] = useState<TitleDraft>({});
  const [serverSnapshot, setServerSnapshot] = useState<TitleDraft>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countyTierDirty, setCountyTierDirty] = useState(false);
  const [duchyTierDirty, setDuchyTierDirty] = useState(false);
  const [kingdomTierDirty, setKingdomTierDirty] = useState(false);
  const [tierDrafts, setTierDrafts] = useState<TierDraftMap>(emptyTierDraftMap);
  const [tierSnapshots, setTierSnapshots] = useState<TierDraftMap>(emptyTierDraftMap);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(serverSnapshot), [draft, serverSnapshot]);

  const anyTierDirty = useMemo(() => {
    for (const targetTier of EDITOR_TIERS) {
      const cached = targetTier === tier ? draft : tierDrafts[targetTier];
      const snapshot = tierSnapshots[targetTier];
      if (cached === null || snapshot === null) continue;
      if (JSON.stringify(cached) !== JSON.stringify(snapshot)) {
        return true;
      }
    }
    return false;
  }, [tier, draft, tierDrafts, tierSnapshots]);

  useEffect(() => {
    setTierDrafts(emptyTierDraftMap());
    setTierSnapshots(emptyTierDraftMap());
  }, [mapId]);

  const loadTier = useCallback(async (targetMapId: MapId, targetTier: EditorTier, token: string | null) => {
    if (!token) {
      setDraft({});
      setServerSnapshot({});
      setSelectedId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchMapJson<TitleDraft>(`/${targetMapId}/data/${targetTier}`, { sessionToken: token });
      const snapshot = cloneDraft(data);
      setDraft(snapshot);
      setServerSnapshot(snapshot);
      setTierDrafts((current) => ({ ...current, [targetTier]: snapshot }));
      setTierSnapshots((current) => ({ ...current, [targetTier]: snapshot }));
      setSelectedId((current) => (current && snapshot[current] ? current : null));
    } catch (err) {
      console.error("Failed to load title tier:", err);
      setError("Failed to load title data. Please try again.");
      setDraft({});
      setServerSnapshot({});
      setTierDrafts((current) => ({ ...current, [targetTier]: {} }));
      setTierSnapshots((current) => ({ ...current, [targetTier]: {} }));
      setSelectedId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setTierDrafts((current) => ({
      ...current,
      [tier]: cloneDraft(draft),
    }));
  }, [tier, draft]);

  useEffect(() => {
    void loadTier(mapId, tier, sessionToken);
  }, [mapId, tier, sessionToken, loadTier]);

  useEffect(() => {
    if (tier === "county" && dirty) {
      setCountyTierDirty(true);
    }
    if (tier === "county" && !dirty) {
      setCountyTierDirty(false);
    }
  }, [tier, dirty]);

  useEffect(() => {
    if (tier === "duchy" && dirty) {
      setDuchyTierDirty(true);
    }
    if (tier === "duchy" && !dirty) {
      setDuchyTierDirty(false);
    }
  }, [tier, dirty]);

  useEffect(() => {
    if (tier === "kingdom" && dirty) {
      setKingdomTierDirty(true);
    }
    if (tier === "kingdom" && !dirty) {
      setKingdomTierDirty(false);
    }
  }, [tier, dirty]);

  const setTier = useCallback(
    (nextTier: EditorTier) => {
      if (nextTier === tier) return;
      if (dirty && !confirmDiscard()) return;
      if (tier === "county" && dirty) {
        setCountyTierDirty(true);
      }
      if (tier === "duchy" && dirty) {
        setDuchyTierDirty(true);
      }
      if (tier === "kingdom" && dirty) {
        setKingdomTierDirty(true);
      }
      setTierState(nextTier);
      setSelectedId(null);
    },
    [dirty, tier],
  );

  const updateEntry = useCallback((id: string, patch: Partial<EditorTitleEntry>) => {
    setDraft((current) => {
      const entry = current[id];
      if (!entry) return current;
      return { ...current, [id]: { ...entry, ...patch } };
    });
  }, []);

  const addTitle = useCallback((id: string, entry: EditorTitleEntry) => {
    setDraft((current) => ({ ...current, [id]: entry }));
    setSelectedId(id);
  }, []);

  const removeTitle = useCallback((id: string) => {
    setDraft((current) => removeTitleFromDraft(current, id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const toggleCountyProvince = useCallback((countyId: string, provinceId: number, options?: ToggleProvinceOptions) => {
    setDraft((current) => {
      const entry = current[countyId];
      if (!entry) return current;
      return {
        ...current,
        [countyId]: toggleProvinceInCounty(entry, provinceId, options),
      };
    });
  }, []);

  const toggleChildMember = useCallback((parentId: string, childId: string, options?: ToggleChildInParentOptions) => {
    setDraft((current) => {
      const entry = current[parentId];
      if (!entry) return current;
      return {
        ...current,
        [parentId]: toggleChildInParent(entry, childId, options),
      };
    });
  }, []);

  const getTierDraftsForExport = useCallback((): TierDraftMap => {
    return {
      ...tierDrafts,
      [tier]: cloneDraft(draft),
    };
  }, [tier, draft, tierDrafts]);

  return {
    mapId,
    tier,
    draft,
    selectedId,
    anyTierDirty,
    countyTierDirty,
    duchyTierDirty,
    kingdomTierDirty,
    loading,
    error,
    setTier,
    selectTitle: setSelectedId,
    updateEntry,
    addTitle,
    removeTitle,
    toggleCountyProvince,
    toggleChildMember,
    getTierDraftsForExport,
  };
}

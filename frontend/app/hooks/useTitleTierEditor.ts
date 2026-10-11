"use client";

import { useCallback, useMemo } from "react";

import type { MapId } from "@/app/components/map/types";
import { useEditorChildLayer } from "@/app/hooks/useEditorChildLayer";
import { useEditorChildPick } from "@/app/hooks/useEditorChildPick";
import { useEditorTitleLayers } from "@/app/hooks/useEditorTitleLayers";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import { buildChildToParentId, canSelectChild } from "@/app/lib/map/editor/childTitleAssignment";
import type { ToggleChildInParentOptions } from "@/app/lib/map/editor/childTitleDraftActions";
import {
  getChildTierConfig,
  isChildTierEditor,
  type ChildTierEditorConfig,
} from "@/app/lib/map/editor/editorTierConfig";
import type { TitlePickIndex } from "@/app/lib/map/editor/buildTitlePickIndex";
import type { TitleLayers } from "@/app/lib/titleProvinces";
import type { EditorTier } from "@/lib/map/api";

type EditorDraftSlice = {
  tier: EditorTier;
  draft: TitleDraft;
  selectedId: string | null;
  countyTierDirty: boolean;
  duchyTierDirty: boolean;
  kingdomTierDirty: boolean;
  toggleChildMember: (parentId: string, childId: string, options?: ToggleChildInParentOptions) => void;
};

function prerequisiteChildDirty(childTier: EditorTier, editor: EditorDraftSlice): boolean {
  if (childTier === "county") return editor.countyTierDirty;
  if (childTier === "duchy") return editor.duchyTierDirty;
  if (childTier === "kingdom") return editor.kingdomTierDirty;
  return false;
}

export function useTitleTierEditor({
  mapId,
  sessionToken,
  editor,
}: {
  mapId: MapId;
  sessionToken: string;
  editor: EditorDraftSlice;
}): {
  config: ChildTierEditorConfig | null;
  childDraft: TitleDraft;
  childPick: TitlePickIndex | null;
  titleLayers: TitleLayers;
  childLayerLoading: boolean;
  childPickLoading: boolean;
  titleLayersLoading: boolean;
  childLayerError: string | null;
  childPickError: string | null;
  prerequisiteBanner: string | null;
  handleChildPickClick: (childId: string) => void;
} {
  const enabled = isChildTierEditor(editor.tier);
  const config = getChildTierConfig(editor.tier);

  const {
    childDraft,
    loading: childLayerLoading,
    error: childLayerError,
    isEmpty: childLayerEmpty,
  } = useEditorChildLayer(mapId, sessionToken, config?.childTier ?? null, enabled);

  const {
    childPick,
    loading: childPickLoading,
    error: childPickError,
  } = useEditorChildPick(mapId, sessionToken, childDraft, config?.pickMapdataPath ?? "", enabled && !childLayerLoading);

  const { titleLayers, loading: titleLayersLoading } = useEditorTitleLayers(
    mapId,
    sessionToken,
    config?.layersNeeded ?? [],
    enabled,
  );

  const prerequisiteBanner = useMemo(() => {
    if (!config) return null;
    const childDirty = prerequisiteChildDirty(config.prerequisiteChildTier, editor);
    if (childLayerEmpty || childDirty) {
      return config.prerequisiteMessage;
    }
    return null;
  }, [config, childLayerEmpty, editor]);

  const handleChildPickClick = useCallback(
    (childId: string) => {
      if (!config || !editor.selectedId) return;

      const assignment = buildChildToParentId(editor.draft);
      const selectedId = editor.selectedId;
      const inSelected = editor.draft[selectedId]?.titles?.includes(childId);

      if (!canSelectChild(childId, selectedId, assignment) && !inSelected) {
        return;
      }

      const usedRgbs = Object.entries(editor.draft)
        .filter(([id]) => id !== selectedId)
        .map(([, entry]) => entry.rgb);

      const childRgb = childDraft[childId]?.rgb;

      editor.toggleChildMember(selectedId, childId, {
        childRgb,
        usedRgbs,
      });
    },
    [config, editor, childDraft],
  );

  return {
    config,
    childDraft,
    childPick,
    titleLayers,
    childLayerLoading,
    childPickLoading,
    titleLayersLoading,
    childLayerError,
    childPickError,
    prerequisiteBanner,
    handleChildPickClick,
  };
}

"use client";

import { useCallback, useState } from "react";

import type { MapId } from "@/app/components/map/types";
import type { TitleDraft } from "@/app/hooks/useEditorDraft";
import type { ChildPickIndex } from "@/app/hooks/useEditorChildPick";
import { provinceAt, type ProvinceIndex } from "@/app/lib/map/editor/buildProvinceIndex";
import { canSelectChild, getChildOwnerName } from "@/app/lib/map/editor/childTitleAssignment";
import { canSelectProvince, getProvinceOwnerName } from "@/app/lib/map/editor/countyAssignment";
import type { ChildTierEditorConfig } from "@/app/lib/map/editor/editorTierConfig";
import { getMapCoords, type MapPickViewport } from "@/app/hooks/useMapCoords";
import type { EditorTier } from "@/lib/map/api";
import type { MutableRefObject, RefObject } from "react";

type CursorTooltip = {
  x: number;
  y: number;
  text: string;
} | null;

export function pickProvinceAt(index: ProvinceIndex, x: number, y: number): number | null {
  // Runs answer directly; touching provinceMap on a runs-backed index would
  // materialise the ~164MB flat map the runs artifact exists to avoid.
  if (index.runs) {
    const pid = provinceAt(index.runs, x, y);
    return pid > 0 ? pid : null;
  }
  if (x < 0 || y < 0 || x >= index.width || y >= index.height) {
    return null;
  }
  const pid = index.provinceMap[y * index.width + x];
  return pid >= 0 ? pid : null;
}

function pickChildAt(index: ProvinceIndex, childPick: ChildPickIndex, x: number, y: number): string | null {
  const provinceId = pickProvinceAt(index, x, y);
  if (provinceId === null) return null;
  return childPick.get(provinceId) ?? null;
}

export function useEditorPick({
  mapId,
  enabled,
  tier,
  childTierConfig,
  index,
  childPick,
  selectedId,
  provinceAssignment,
  childAssignment,
  draft,
  viewportCoordsRef,
  pickCanvasRef,
  onProvinceClick,
  onChildClick,
}: {
  mapId: MapId;
  enabled: boolean;
  tier: EditorTier;
  childTierConfig: ChildTierEditorConfig | null;
  index: ProvinceIndex | null;
  childPick: ChildPickIndex | null;
  selectedId: string | null;
  provinceAssignment: Map<number, string>;
  childAssignment: Map<string, string>;
  draft: TitleDraft;
  viewportCoordsRef: MutableRefObject<MapPickViewport | null>;
  pickCanvasRef: RefObject<HTMLCanvasElement | null>;
  onProvinceClick: (provinceId: number) => void;
  onChildClick: (childId: string) => void;
}): {
  onClick: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (event: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseLeave: () => void;
  cursorTooltip: CursorTooltip;
  isHoveringClickable: boolean;
} {
  const [cursorTooltip, setCursorTooltip] = useState<CursorTooltip>(null);
  const [isHoveringClickable, setIsHoveringClickable] = useState(false);

  const isChildTier = childTierConfig !== null;

  const resolvePick = useCallback(
    (
      event: React.MouseEvent<HTMLCanvasElement>,
    ): {
      provinceId: number | null;
      childId: string | null;
    } => {
      if (!enabled) return { provinceId: null, childId: null };

      const canvas = pickCanvasRef.current ?? event.currentTarget;
      const coords = getMapCoords(event, canvas, mapId, viewportCoordsRef.current);
      if (!coords) return { provinceId: null, childId: null };

      if (tier === "county" && index) {
        return {
          provinceId: pickProvinceAt(index, coords.x, coords.y),
          childId: null,
        };
      }

      if (isChildTier && childPick && index) {
        return {
          provinceId: null,
          childId: pickChildAt(index, childPick, coords.x, coords.y),
        };
      }

      return { provinceId: null, childId: null };
    },
    [enabled, tier, isChildTier, index, childPick, mapId, pickCanvasRef, viewportCoordsRef],
  );

  const onClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const { provinceId, childId } = resolvePick(event);

      if (tier === "county" && provinceId !== null) {
        if (!selectedId) return;
        if (!canSelectProvince(provinceId, selectedId, provinceAssignment)) {
          const inSelected = draft[selectedId]?.provinces?.includes(provinceId);
          if (!inSelected) return;
        }
        onProvinceClick(provinceId);
        return;
      }

      if (isChildTier && childId) {
        if (!selectedId) return;
        if (!canSelectChild(childId, selectedId, childAssignment)) {
          const inSelected = draft[selectedId]?.titles?.includes(childId);
          if (!inSelected) return;
        }
        onChildClick(childId);
      }
    },
    [
      resolvePick,
      tier,
      isChildTier,
      selectedId,
      provinceAssignment,
      childAssignment,
      draft,
      onProvinceClick,
      onChildClick,
    ],
  );

  const onMouseMove = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const { provinceId, childId } = resolvePick(event);

      if (tier === "county") {
        if (provinceId === null) {
          setCursorTooltip(null);
          setIsHoveringClickable(false);
          return;
        }

        const owner = provinceAssignment.get(provinceId);
        let clickable = false;
        let text = `Province ${provinceId}`;

        if (!selectedId) {
          clickable = false;
        } else if (!owner) {
          clickable = true;
        } else if (owner === selectedId) {
          clickable = true;
          text = `Province ${provinceId} - click to remove`;
        } else {
          const ownerName = getProvinceOwnerName(provinceId, provinceAssignment, draft);
          text = `Assigned to ${ownerName ?? owner}`;
        }

        setIsHoveringClickable(clickable);
        setCursorTooltip({ x: event.clientX, y: event.clientY, text });
        return;
      }

      if (isChildTier && childTierConfig) {
        if (!childId) {
          setCursorTooltip(null);
          setIsHoveringClickable(false);
          return;
        }

        const owner = childAssignment.get(childId);
        let clickable = false;
        let text = `${childTierConfig.childLabel} ${childId}`;

        if (!selectedId) {
          clickable = false;
        } else if (!owner) {
          clickable = true;
        } else if (owner === selectedId) {
          clickable = true;
          text = `${childTierConfig.childLabel} ${childId} - click to remove`;
        } else {
          const ownerName = getChildOwnerName(childId, childAssignment, draft);
          text = `Assigned to ${ownerName ?? owner}`;
        }

        setIsHoveringClickable(clickable);
        setCursorTooltip({ x: event.clientX, y: event.clientY, text });
        return;
      }

      setCursorTooltip(null);
      setIsHoveringClickable(false);
    },
    [resolvePick, tier, isChildTier, childTierConfig, selectedId, provinceAssignment, childAssignment, draft],
  );

  const onMouseLeave = useCallback(() => {
    setCursorTooltip(null);
    setIsHoveringClickable(false);
  }, []);

  return {
    onClick,
    onMouseMove,
    onMouseLeave,
    cursorTooltip,
    isHoveringClickable,
  };
}

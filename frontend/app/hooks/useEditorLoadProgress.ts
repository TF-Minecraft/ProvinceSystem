"use client";

import { useCallback, useMemo, useState } from "react";

import {
  computeEditorLoadProgress,
  getEnabledStages,
  type EditorLoadStageId,
  type EditorLoadProgressOptions,
} from "@/app/lib/map/editor/editorLoadProgress";

export function useEditorLoadProgress(options: EditorLoadProgressOptions) {
  const enabledStages = useMemo(() => getEnabledStages(options), [options.needsProvinceIndex, options.childTierMode]);

  const [completed, setCompleted] = useState<Set<EditorLoadStageId>>(() => new Set());
  const [activeStage, setActiveStage] = useState<EditorLoadStageId | null>(null);

  const markActive = useCallback((stageId: EditorLoadStageId) => {
    setActiveStage(stageId);
  }, []);

  const markComplete = useCallback((stageId: EditorLoadStageId) => {
    setCompleted((current) => {
      if (current.has(stageId)) return current;
      const next = new Set(current);
      next.add(stageId);
      return next;
    });
    setActiveStage((current) => (current === stageId ? null : current));
  }, []);

  const resetStages = useCallback((stageIds: readonly EditorLoadStageId[]) => {
    setCompleted((current) => {
      const next = new Set(current);
      for (const stageId of stageIds) {
        next.delete(stageId);
      }
      return next;
    });
  }, []);

  const progress = computeEditorLoadProgress(enabledStages, completed, activeStage);

  return {
    enabledStages,
    percent: progress.percent,
    label: progress.label,
    ready: progress.ready,
    markActive,
    markComplete,
    resetStages,
  };
}

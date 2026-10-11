export type EditorLoadStageId = "titles" | "provinceCatalog" | "provinceGrid" | "mapImage" | "childPick";

export const EDITOR_LOAD_STAGE_WEIGHTS: Record<EditorLoadStageId, number> = {
  titles: 15,
  provinceCatalog: 10,
  provinceGrid: 35,
  mapImage: 25,
  childPick: 15,
};

export const EDITOR_LOAD_STAGE_LABELS: Record<EditorLoadStageId, string> = {
  titles: "Loading title data...",
  provinceCatalog: "Loading province catalog...",
  provinceGrid: "Loading province index...",
  mapImage: "Loading map image...",
  childPick: "Loading pick layers...",
};

export type EditorLoadProgressOptions = {
  needsProvinceIndex: boolean;
  childTierMode: boolean;
};

export function getEnabledStages(options: EditorLoadProgressOptions): EditorLoadStageId[] {
  const stages: EditorLoadStageId[] = ["titles"];

  if (options.needsProvinceIndex) {
    stages.push("provinceCatalog", "provinceGrid");
  }

  stages.push("mapImage");

  if (options.childTierMode) {
    stages.push("childPick");
  }

  return stages;
}

export function computeEditorLoadProgress(
  enabledStages: readonly EditorLoadStageId[],
  completed: ReadonlySet<EditorLoadStageId>,
  activeStage: EditorLoadStageId | null,
): { percent: number; label: string; ready: boolean } {
  const totalWeight = enabledStages.reduce((sum, stageId) => sum + EDITOR_LOAD_STAGE_WEIGHTS[stageId], 0);

  if (totalWeight <= 0) {
    return { percent: 100, label: "", ready: true };
  }

  const completedWeight = enabledStages.reduce((sum, stageId) => {
    return completed.has(stageId) ? sum + EDITOR_LOAD_STAGE_WEIGHTS[stageId] : sum;
  }, 0);

  const ready = enabledStages.every((stageId) => completed.has(stageId));
  const percent = ready ? 100 : Math.min(99, Math.round((completedWeight / totalWeight) * 100));

  let label = "Loading...";
  if (activeStage && !completed.has(activeStage)) {
    label = EDITOR_LOAD_STAGE_LABELS[activeStage];
  } else if (!ready) {
    const nextStage = enabledStages.find((stageId) => !completed.has(stageId));
    if (nextStage) {
      label = EDITOR_LOAD_STAGE_LABELS[nextStage];
    }
  }

  return { percent, label, ready };
}

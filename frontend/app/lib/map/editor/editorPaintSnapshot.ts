import type { EditorTitleEntry, TitleDraft } from "@/app/hooks/useEditorDraft";

function arraysEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function stringArraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type CountyPaintSnapshot = {
  colors: Record<string, string>;
  provincesByCounty: Record<string, readonly number[]>;
  selectedId: string | null;
  selectedRgb: string | undefined;
  selectedProvinces: readonly number[] | undefined;
};

export type CountyPaintDiff = {
  changedProvinceIds: number[];
  changedCountyIds: string[];
  activeLayerChanged: boolean;
  prevSelectedProvinces: readonly number[] | undefined;
};

export type ChildTierPaintSnapshot = {
  childColors: Record<string, string>;
  parentMembers: Record<string, readonly string[]>;
  selectedId: string | null;
  selectedRgb: string | undefined;
  selectedMembers: readonly string[] | undefined;
};

export type ChildTierPaintDiff = {
  changedChildIds: string[];
  changedParentIds: string[];
  activeLayerChanged: boolean;
  prevSelectedMembers: readonly string[] | undefined;
};

export function extractCountyPaintSnapshot(draft: TitleDraft, selectedId: string | null): CountyPaintSnapshot {
  const colors: Record<string, string> = {};
  const provincesByCounty: Record<string, readonly number[]> = {};

  for (const [id, entry] of Object.entries(draft)) {
    colors[id] = entry.rgb;
    provincesByCounty[id] = entry.provinces ?? [];
  }

  const selectedEntry = selectedId ? draft[selectedId] : undefined;

  return {
    colors,
    provincesByCounty,
    selectedId,
    selectedRgb: selectedEntry?.rgb,
    selectedProvinces: selectedEntry?.provinces,
  };
}

export function diffCountyPaintSnapshot(
  prev: CountyPaintSnapshot | null,
  next: CountyPaintSnapshot,
): CountyPaintDiff | null {
  if (!prev) return null;

  const changedProvinceIds = new Set<number>();
  const changedCountyIds = new Set<string>();
  const allCountyIds = new Set([...Object.keys(prev.provincesByCounty), ...Object.keys(next.provincesByCounty)]);

  for (const countyId of allCountyIds) {
    const prevProvinces = prev.provincesByCounty[countyId] ?? [];
    const nextProvinces = next.provincesByCounty[countyId] ?? [];
    const colorChanged = prev.colors[countyId] !== next.colors[countyId];
    const membershipChanged = !arraysEqual(prevProvinces, nextProvinces);

    if (colorChanged) {
      changedCountyIds.add(countyId);
      for (const pid of prevProvinces) changedProvinceIds.add(pid);
      for (const pid of nextProvinces) changedProvinceIds.add(pid);
    } else if (membershipChanged) {
      for (const pid of prevProvinces) changedProvinceIds.add(pid);
      for (const pid of nextProvinces) changedProvinceIds.add(pid);
    }
  }

  const activeLayerChanged =
    prev.selectedId !== next.selectedId ||
    prev.selectedRgb !== next.selectedRgb ||
    !arraysEqual(prev.selectedProvinces ?? [], next.selectedProvinces ?? []);

  return {
    changedProvinceIds: [...changedProvinceIds],
    changedCountyIds: [...changedCountyIds],
    activeLayerChanged,
    prevSelectedProvinces: prev.selectedProvinces,
  };
}

export function isCountyPaintDiffEmpty(diff: CountyPaintDiff): boolean {
  return diff.changedProvinceIds.length === 0 && !diff.activeLayerChanged;
}

export function extractChildTierPaintSnapshot(
  draft: TitleDraft,
  childDraft: Record<string, EditorTitleEntry>,
  selectedId: string | null,
): ChildTierPaintSnapshot {
  const childColors: Record<string, string> = {};
  const parentMembers: Record<string, readonly string[]> = {};

  for (const [id, entry] of Object.entries(childDraft)) {
    childColors[id] = entry.rgb;
  }

  for (const [id, entry] of Object.entries(draft)) {
    parentMembers[id] = entry.titles ?? [];
  }

  const selectedEntry = selectedId ? draft[selectedId] : undefined;

  return {
    childColors,
    parentMembers,
    selectedId,
    selectedRgb: selectedEntry?.rgb,
    selectedMembers: selectedEntry?.titles,
  };
}

export function diffChildTierPaintSnapshot(
  prev: ChildTierPaintSnapshot | null,
  next: ChildTierPaintSnapshot,
): ChildTierPaintDiff | null {
  if (!prev) return null;

  const changedChildIds = new Set<string>();
  const changedParentIds = new Set<string>();

  const allChildIds = new Set([...Object.keys(prev.childColors), ...Object.keys(next.childColors)]);
  for (const childId of allChildIds) {
    if (prev.childColors[childId] !== next.childColors[childId]) {
      changedChildIds.add(childId);
    }
  }

  const allParentIds = new Set([...Object.keys(prev.parentMembers), ...Object.keys(next.parentMembers)]);
  for (const parentId of allParentIds) {
    const prevMembers = prev.parentMembers[parentId] ?? [];
    const nextMembers = next.parentMembers[parentId] ?? [];
    if (!stringArraysEqual(prevMembers, nextMembers)) {
      changedParentIds.add(parentId);
    }
  }

  const activeLayerChanged =
    prev.selectedId !== next.selectedId ||
    prev.selectedRgb !== next.selectedRgb ||
    !stringArraysEqual(prev.selectedMembers ?? [], next.selectedMembers ?? []);

  return {
    changedChildIds: [...changedChildIds],
    changedParentIds: [...changedParentIds],
    activeLayerChanged,
    prevSelectedMembers: prev.selectedMembers,
  };
}

export function isChildTierPaintDiffEmpty(diff: ChildTierPaintDiff): boolean {
  return diff.changedChildIds.length === 0 && diff.changedParentIds.length === 0 && !diff.activeLayerChanged;
}

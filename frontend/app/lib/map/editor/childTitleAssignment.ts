import type { TitleDraft } from "@/app/hooks/useEditorDraft";

export type ParentDraft = Record<string, { name?: string; titles?: string[] }>;

export function buildChildToParentId(parentDraft: ParentDraft): Map<string, string> {
  const map = new Map<string, string>();
  for (const [parentId, entry] of Object.entries(parentDraft)) {
    for (const childId of entry.titles ?? []) {
      map.set(childId, parentId);
    }
  }
  return map;
}

export function canSelectChild(
  childId: string,
  editingParentId: string | null,
  assignment: Map<string, string>,
): boolean {
  if (!editingParentId) return false;
  const owner = assignment.get(childId);
  if (!owner) return true;
  return owner === editingParentId;
}

export function findDuplicateChildIds(parentDraft: ParentDraft): string[] {
  const seen = new Map<string, string>();
  const duplicates: string[] = [];

  for (const [parentId, entry] of Object.entries(parentDraft)) {
    for (const childId of entry.titles ?? []) {
      if (seen.has(childId)) {
        if (!duplicates.includes(childId)) {
          duplicates.push(childId);
        }
      } else {
        seen.set(childId, parentId);
      }
    }
  }

  return duplicates;
}

export function getChildOwnerName(
  childId: string,
  assignment: Map<string, string>,
  parentDraft: TitleDraft,
): string | null {
  const parentId = assignment.get(childId);
  if (!parentId) return null;
  const entry = parentDraft[parentId];
  return entry?.name ?? parentId;
}

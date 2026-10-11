import type { TitleDraft } from "@/app/hooks/useEditorDraft";

export type CountyDraft = Record<string, { name?: string; provinces?: number[] }>;

export function buildProvinceToCountyId(draft: CountyDraft): Map<number, string> {
  const map = new Map<number, string>();
  for (const [countyId, entry] of Object.entries(draft)) {
    for (const pid of entry.provinces ?? []) {
      map.set(pid, countyId);
    }
  }
  return map;
}

export function unassignedProvinces(catalogIds: readonly number[], assignment: Map<number, string>): number[] {
  return catalogIds.filter((pid) => !assignment.has(pid));
}

export function canSelectProvince(
  provinceId: number,
  editingId: string | null,
  assignment: Map<number, string>,
): boolean {
  if (!editingId) return false;
  const owner = assignment.get(provinceId);
  if (!owner) return true;
  return owner === editingId;
}

export function findDuplicateProvinceIds(draft: CountyDraft): number[] {
  const seen = new Map<number, string>();
  const duplicates: number[] = [];

  for (const [countyId, entry] of Object.entries(draft)) {
    for (const pid of entry.provinces ?? []) {
      if (seen.has(pid)) {
        if (!duplicates.includes(pid)) {
          duplicates.push(pid);
        }
      } else {
        seen.set(pid, countyId);
      }
    }
  }

  return duplicates;
}

export function getProvinceOwnerName(
  provinceId: number,
  assignment: Map<number, string>,
  draft: TitleDraft,
): string | null {
  const countyId = assignment.get(provinceId);
  if (!countyId) return null;
  const entry = draft[countyId];
  return entry?.name ?? countyId;
}

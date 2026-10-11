import type { WarExport, WarScheduleSlot } from "../components/map/types";
import { cleanRegionName } from "./mapLabels";
import type { MapMarker } from "./mapMarkers";

export const BATTLE_MARKER_KIND = "battle";
export const BATTLE_NEXT_BASE_SCALE = 1.1;
export const BATTLE_MARKER_Y_OFFSET = 30;

export function formatBattleSlotStatus(status: WarScheduleSlot["status"]): string {
  switch (status) {
    case "next":
      return "Next battle";
    case "fought":
      return "Fought";
    case "upcoming":
      return "Upcoming";
    default:
      return status;
  }
}

export function formatBattleProvinceName(slot: WarScheduleSlot): string {
  if (slot.province_name) {
    const cleaned = cleanRegionName(slot.province_name);
    if (cleaned) return cleaned;
  }
  return `Province ${slot.province_id}`;
}

export function formatBattleMarkerTitle(slot: WarScheduleSlot): string {
  const statusLabel = formatBattleSlotStatus(slot.status);
  if (slot.display_name) {
    return `${slot.display_name} - ${statusLabel}`;
  }
  const kindLabel = slot.kind_label || slot.kind;
  const province = formatBattleProvinceName(slot);
  return `${kindLabel} - ${province} - ${statusLabel}`;
}

function hasPlacedCoords(slot: WarScheduleSlot): boolean {
  return (
    typeof slot.map_x === "number" &&
    Number.isFinite(slot.map_x) &&
    typeof slot.map_y === "number" &&
    Number.isFinite(slot.map_y)
  );
}

export function slotToMapMarker(warId: string, slot: WarScheduleSlot): MapMarker {
  const isNext = slot.status === "next";
  return {
    id: `war-${warId}-slot-${slot.leg}-${slot.schedule_index}`,
    kind: BATTLE_MARKER_KIND,
    markerSize: "small",
    mapX: slot.map_x!,
    mapY: slot.map_y! - BATTLE_MARKER_Y_OFFSET,
    label: slot.kind_label || slot.kind,
    title: formatBattleMarkerTitle(slot),
    showLabelOnlyOnHover: true,
    baseScale: isNext ? BATTLE_NEXT_BASE_SCALE : 1,
  };
}

type SlotCandidate = {
  warId: string;
  slot: WarScheduleSlot;
};

function slotDedupeKey(warId: string, slot: WarScheduleSlot): string {
  return `${warId}:${slot.leg}:${slot.schedule_index}`;
}

function compareSlotCandidates(a: SlotCandidate, b: SlotCandidate): number {
  return a.slot.schedule_index - b.slot.schedule_index;
}

function collectWarSlots(war: WarExport): SlotCandidate[] {
  const candidates: SlotCandidate[] = [];
  const schedules = [war.campaign_battle_schedule ?? [], war.campaign_counter_schedule ?? []];

  for (const schedule of schedules) {
    for (const slot of schedule) {
      if (!hasPlacedCoords(slot)) continue;
      candidates.push({ warId: war.id, slot });
    }
  }

  return candidates;
}

function dedupeSlotCandidates(candidates: SlotCandidate[]): SlotCandidate[] {
  const bestByKey = new Map<string, SlotCandidate>();

  for (const candidate of candidates) {
    const key = slotDedupeKey(candidate.warId, candidate.slot);
    const existing = bestByKey.get(key);
    if (!existing || compareSlotCandidates(candidate, existing) < 0) {
      bestByKey.set(key, candidate);
    }
  }

  return Array.from(bestByKey.values());
}

export function warBattleMarkersFromWars(wars: WarExport[]): MapMarker[] {
  const markers: MapMarker[] = [];

  for (const war of wars) {
    const deduped = dedupeSlotCandidates(collectWarSlots(war));
    for (const { warId, slot } of deduped) {
      if (slot.status !== "next") continue;
      markers.push(slotToMapMarker(warId, slot));
    }
  }

  return markers;
}

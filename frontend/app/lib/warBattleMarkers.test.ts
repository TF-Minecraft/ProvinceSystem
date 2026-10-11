import { describe, expect, it } from "vitest";

import type { WarExport, WarScheduleSlot } from "../components/map/types";
import {
  formatBattleMarkerTitle,
  formatBattleSlotStatus,
  slotToMapMarker,
  warBattleMarkersFromWars,
} from "./warBattleMarkers";

const sampleSlot = (overrides: Partial<WarScheduleSlot> = {}): WarScheduleSlot => ({
  schedule_index: 0,
  leg: "invasion" as const,
  province_id: 20,
  kind: "siege",
  kind_label: "Siege",
  status: "next" as const,
  province_name: "Greenfort",
  map_x: 300,
  map_y: 400,
  ...overrides,
});

describe("formatBattleSlotStatus", () => {
  it("maps API status values to display labels", () => {
    expect(formatBattleSlotStatus("next")).toBe("Next battle");
    expect(formatBattleSlotStatus("fought")).toBe("Fought");
    expect(formatBattleSlotStatus("upcoming")).toBe("Upcoming");
  });
});

describe("formatBattleMarkerTitle", () => {
  it("builds title with kind, province, and status", () => {
    expect(formatBattleMarkerTitle(sampleSlot())).toBe("Siege - Greenfort - Next battle");
  });

  it("strips Minecraft hex from province names", () => {
    expect(
      formatBattleMarkerTitle(
        sampleSlot({
          province_name: "§x§f§f§0§0§0§0Greenfort",
        }),
      ),
    ).toBe("Siege - Greenfort - Next battle");
  });

  it("falls back to province id when name is missing", () => {
    expect(
      formatBattleMarkerTitle(
        sampleSlot({
          province_name: undefined,
          province_id: 42,
        }),
      ),
    ).toBe("Siege - Province 42 - Next battle");
  });

  it("uses display_name when present", () => {
    expect(
      formatBattleMarkerTitle(
        sampleSlot({
          display_name: "Siege of Greenfort",
        }),
      ),
    ).toBe("Siege of Greenfort - Next battle");
  });
});

describe("slotToMapMarker", () => {
  it("creates battle marker with stable id and next highlight", () => {
    const marker = slotToMapMarker("war-1", sampleSlot());
    expect(marker).toMatchObject({
      id: "war-war-1-slot-invasion-0",
      kind: "battle",
      mapX: 300,
      mapY: 370,
      label: "Siege",
      showLabelOnlyOnHover: true,
      baseScale: 1.1,
    });
    expect(marker.highlightRing).toBeUndefined();
    expect(marker.title).toBe("Siege - Greenfort - Next battle");
  });

  it("uses base scale 1 for non-next slots", () => {
    const marker = slotToMapMarker("war-1", sampleSlot({ status: "upcoming" }));
    expect(marker.baseScale).toBe(1);
    expect(marker.highlightRing).toBeUndefined();
  });
});

describe("warBattleMarkersFromWars", () => {
  it("shows only the next battle slot", () => {
    const wars: WarExport[] = [
      {
        id: "1",
        campaign_battle_schedule: [
          sampleSlot({ schedule_index: 0, leg: "invasion", status: "fought" }),
          sampleSlot({
            schedule_index: 1,
            leg: "invasion",
            map_x: 310,
            map_y: 410,
            status: "next",
          }),
          sampleSlot({
            schedule_index: 2,
            leg: "invasion",
            map_x: 320,
            map_y: 420,
            status: "upcoming",
          }),
        ],
        campaign_counter_schedule: [
          sampleSlot({
            schedule_index: 0,
            leg: "counter",
            map_x: 250,
            map_y: 380,
            status: "upcoming",
          }),
        ],
      },
    ];

    const markers = warBattleMarkersFromWars(wars);
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe("war-1-slot-invasion-1");
    expect(markers[0].mapY).toBe(380);
    expect(markers[0].title).toContain("Next battle");
  });

  it("omits slots without map coordinates", () => {
    const wars: WarExport[] = [
      {
        id: "1",
        campaign_battle_schedule: [sampleSlot({ map_x: undefined, map_y: undefined })],
      },
    ];

    expect(warBattleMarkersFromWars(wars)).toEqual([]);
  });

  it("keeps invasion and counter slots at same coordinates", () => {
    const wars: WarExport[] = [
      {
        id: "1",
        campaign_battle_schedule: [
          sampleSlot({
            schedule_index: 0,
            leg: "invasion",
            status: "upcoming",
          }),
        ],
        campaign_counter_schedule: [
          sampleSlot({
            schedule_index: 0,
            leg: "counter",
            status: "next",
          }),
        ],
      },
    ];

    const markers = warBattleMarkersFromWars(wars);
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe("war-1-slot-counter-0");
    expect(markers[0].title).toContain("Next battle");
  });

  it("keeps siege and field at same province", () => {
    const wars: WarExport[] = [
      {
        id: "1",
        campaign_battle_schedule: [
          sampleSlot({
            schedule_index: 0,
            leg: "invasion",
            kind: "siege",
            kind_label: "Siege",
            display_name: "Siege of Greenfort",
            status: "upcoming",
          }),
          sampleSlot({
            schedule_index: 1,
            leg: "invasion",
            kind: "field",
            kind_label: "Field Battle",
            display_name: "Battle of Lanbury",
            status: "next",
          }),
        ],
      },
    ];

    const markers = warBattleMarkersFromWars(wars);
    expect(markers).toHaveLength(1);
    expect(markers[0].title).toBe("Battle of Lanbury - Next battle");
    expect(markers[0].mapY).toBe(370);
  });
});

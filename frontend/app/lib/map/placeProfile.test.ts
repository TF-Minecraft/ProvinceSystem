import { describe, expect, it } from "vitest";

import { buildPlaceProfile, placeMarkerIdForSearchKey } from "./placeProfile";

const regionData = { Huoyaoguo: { name: "Huǒyàoguó", rgb: "1,1,1" } };

const settlements = [
  {
    id: "Porokhgrad",
    name: "§x§a§3§a§1§8§4Porokhgrad",
    faction_id: "Huoyaoguo",
    kind: "faction_capital" as const,
    population: 8,
    province_id: 696,
    provinces: [696, 697],
    map_x: 995,
    map_y: 2546,
  },
];

const installations = [
  {
    id: "harbour",
    name: "Grand Port",
    kind: "port" as const,
    faction_id: "Gone",
    province_id: 12,
    hub_slots: 3,
    hubs: 1,
    map_x: 5,
    map_y: 6,
  },
];

const marker = (id: string, kind: string, extra = {}) => ({
  id,
  kind,
  mapX: 1,
  mapY: 2,
  label: "Label",
  title: "Title",
  ...extra,
});

describe("buildPlaceProfile", () => {
  it("describes a capital with its realm, population and provinces", () => {
    expect(
      buildPlaceProfile(marker("Porokhgrad", "faction_capital"), settlements, [], regionData)
    ).toMatchObject({
      name: "Porokhgrad",
      kindLabel: "Capital",
      ownerId: "Huoyaoguo",
      population: 8,
      provinces: [696, 697],
      hubs: null,
    });
  });

  it("describes an installation's hubs, and drops an owner the map does not know", () => {
    expect(
      buildPlaceProfile(marker("installation:harbour", "port"), [], installations, regionData)
    ).toMatchObject({
      name: "Grand Port",
      kindLabel: "Port",
      ownerId: null,
      provinces: [12],
      hubs: 1,
      hubSlots: 3,
    });
  });

  it("falls back to the marker for battles and unknown places", () => {
    expect(
      buildPlaceProfile(marker("war-1-slot", "battle", { title: "Siege of X" }), [], [], null)
    ).toMatchObject({ kindLabel: "Battle", note: "Siege of X" });
    expect(buildPlaceProfile(marker("ghost", "settlement"), [], [], null)).toMatchObject({
      name: "Label",
      kindLabel: "Place",
    });
  });
});

describe("guild capitals", () => {
  it("calls a settlement a guild's capital when a guild has made it one", () => {
    const withGuild = {
      Thalendor: {
        name: "Thalendor",
        guilds: [{ id: "Oyfthyr", name: "Oyfthyr", type: "guild", capital: 163, members: [] }],
      },
    };
    const town = [{ id: "Oyfthyr", name: "Oyfthyr", faction_id: "Thalendor", kind: "settlement" as const, province_id: 163 }];
    expect(
      buildPlaceProfile(marker("Oyfthyr", "settlement"), town, [], withGuild as never).kindLabel
    ).toBe("Guild capital");
    expect(
      buildPlaceProfile(marker("Oyfthyr", "settlement"), town, [], regionData).kindLabel
    ).toBe("Settlement");
  });
});

describe("placeMarkerIdForSearchKey", () => {
  it("maps search results to marker ids", () => {
    expect(placeMarkerIdForSearchKey("settlement:Porokhgrad")).toBe("Porokhgrad");
    expect(placeMarkerIdForSearchKey("installation:harbour")).toBe("installation:harbour");
    expect(placeMarkerIdForSearchKey("region:X")).toBeNull();
  });
});

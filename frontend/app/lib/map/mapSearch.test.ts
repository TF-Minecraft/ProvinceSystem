import { describe, expect, it } from "vitest";

import {
  buildMapSearchIndex,
  normaliseSearchText,
  searchMap,
} from "./mapSearch";

const regionData = {
  Huoyaoguo: { name: "Huǒyàoguó", rgb: "200,80,80" },
  Fingers: { name: "Fingers", overlord: "Huoyaoguo" },
  The_Holy_Order: { name: "The Holy Order", rgb: "150,90,200" },
  Thalendor: { name: "§x§a§3§a§1§8§4Thalendor" },
};

const index = buildMapSearchIndex({
  regionData,
  tierLabel: "Nation",
  settlements: [
    {
      id: "s1",
      name: "Cru' Sadin",
      faction_id: "The_Holy_Order",
      kind: "faction_capital",
      map_x: 100,
      map_y: 200,
    },
    { id: "s2", name: "Unplaced Town" },
  ],
  installations: [
    { id: "i1", name: "Holy Harbour", kind: "port", map_x: 5, map_y: 6 },
  ],
});

describe("normaliseSearchText", () => {
  it("strips accents and case", () => {
    expect(normaliseSearchText("  Huǒyàoguó ")).toBe("huoyaoguo");
  });
});

describe("buildMapSearchIndex", () => {
  it("indexes regions with clean names and their overlord", () => {
    const fingers = index.find((entry) => entry.key === "region:Fingers");
    const thalendor = index.find((entry) => entry.key === "region:Thalendor");

    expect(fingers?.detail).toBe("Subject of Huǒyàoguó");
    expect(thalendor?.label).toBe("Thalendor");
    expect(thalendor?.detail).toBe("Nation");
  });

  it("indexes placed settlements and installations with their owner", () => {
    expect(index.find((entry) => entry.key === "settlement:s1")).toMatchObject({
      kind: "place",
      label: "Cru' Sadin",
      detail: "Capital · The Holy Order",
      mapX: 100,
      mapY: 200,
    });
    expect(index.find((entry) => entry.key === "installation:i1")?.detail).toBe("Port");
  });

  it("skips places with no map position", () => {
    expect(index.some((entry) => entry.label === "Unplaced Town")).toBe(false);
  });

  it("searches places alone when the mode has no regions", () => {
    const placesOnly = buildMapSearchIndex({
      regionData: null,
      tierLabel: "Terrain",
      settlements: [],
      installations: [{ id: "i1", name: "Port", kind: "port", map_x: 1, map_y: 1 }],
    });

    expect(placesOnly).toHaveLength(1);
  });
});

describe("searchMap", () => {
  it("finds accented names from plain typing", () => {
    expect(searchMap(index, "huoy")[0]?.label).toBe("Huǒyàoguó");
  });

  it("ranks a prefix, then a word start, then a substring", () => {
    const labels = searchMap(index, "ho").map((entry) => entry.label);

    expect(labels).toEqual(["Holy Harbour", "The Holy Order"]);
    expect(searchMap(index, "sadin")[0]?.label).toBe("Cru' Sadin");
    expect(searchMap(index, "lendor")[0]?.label).toBe("Thalendor");
  });

  it("prefers a region over a place on an equal match", () => {
    const results = searchMap(
      [
        { kind: "place", key: "p", label: "Rat Hill", detail: "", mapX: 0, mapY: 0 },
        { kind: "region", key: "r", regionId: "Rat_Hill", label: "Rat Hill", detail: "", rgb: null },
      ],
      "rat"
    );

    expect(results[0]?.kind).toBe("region");
  });

  it("returns nothing for an empty query and respects the limit", () => {
    expect(searchMap(index, "   ")).toEqual([]);
    expect(searchMap(index, "o", 2)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";

import { selectionCropPaths } from "./drillUtils";
import type { MapObject, RegionRecord } from "./types";

const regions: RegionRecord = {
  Order: { subjects: ["Reach", "Hold"], size: 10 },
  Reach: { overlord: "Order", subjects: ["Tower"], size: 4 },
  Hold: { overlord: "Order", size: 3 },
  Tower: { overlord: "Reach", size: 1 },
  Lone: { size: 2 },
};

function obj(baseId: string, nested = false): MapObject {
  const id = nested ? `${baseId}_nested` : baseId;
  return { id, baseId, nested, visible: !nested, path: id.toLowerCase() };
}

const objects = ["Order", "Reach", "Hold", "Tower", "Lone"].map((id) => obj(id));
objects.push(obj("Order", true), obj("Reach", true));

describe("selectionCropPaths", () => {
  it("loads a realm's shape, nested layout and subjects", () => {
    expect(selectionCropPaths("Order", regions, objects)).toEqual(["order", "order_nested", "reach", "hold"]);
  });

  it("opens the overlord of a region without subjects", () => {
    expect(selectionCropPaths("Hold", regions, objects)).toEqual(["hold", "order", "order_nested", "reach"]);
  });

  it("opens a subject that has subjects of its own", () => {
    expect(selectionCropPaths("Reach", regions, objects)).toEqual(["reach", "reach_nested", "tower"]);
  });

  it("loads a lone region alone and nothing for an unknown id", () => {
    expect(selectionCropPaths("Lone", regions, objects)).toEqual(["lone"]);
    expect(selectionCropPaths("Nowhere", regions, objects)).toEqual([]);
  });
});

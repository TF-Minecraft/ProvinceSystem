import { describe, expect, it } from "vitest";

import {
  CHRONICLE_FOCUS_NONE,
  chronicleFocusOptions,
  chronicleFocusProvinceIds,
  focusChronicleLabels,
  focusOwnsMarker,
} from "./chronicleFocus";
import type { RegionRecord } from "../../components/map/types";
import type { NationLabelSpec } from "../mapLabels";

function label(overrides: Partial<NationLabelSpec> = {}): NationLabelSpec {
  return {
    nationId: "N1",
    componentIndex: 0,
    text: "Adavaar",
    scope: "nation" as NationLabelSpec["scope"],
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 0,
    cx: 5,
    cy: 0,
    angleDeg: 0,
    segmentPx: 10,
    fontSize: 20,
    pathD: "M 0 0 L 10 0",
    pathOffsetX: 0,
    pathOffsetY: 0,
    ...overrides,
  };
}

const FILE: RegionRecord = {
  zeta: { name: "§aZeta", rgb: "1,2,3", provinces: [4, 5] },
  alpha: { name: "Alpha", rgb: "9,9,9", provinces: [1], occupied_held: [2] },
  nameless: { rgb: "5,5,5", provinces: [7] },
};

describe("chronicleFocusOptions", () => {
  it("lists the day's realms by display name, colour codes stripped", () => {
    expect(chronicleFocusOptions(FILE)).toEqual([
      { id: "alpha", name: "Alpha" },
      { id: "nameless", name: "nameless" },
      { id: "zeta", name: "Zeta" },
    ]);
  });

  it("has nothing to offer without a nation file", () => {
    expect(chronicleFocusOptions(null)).toEqual([]);
  });

  it("skips entries a malformed day file left as non-objects", () => {
    const junk = { good: { name: "Good" }, bad: "not a realm" };
    expect(
      chronicleFocusOptions(junk as unknown as RegionRecord)
    ).toEqual([{ id: "good", name: "Good" }]);
  });
});

describe("chronicleFocusProvinceIds", () => {
  it("is null with no focus, so callers leave their input alone", () => {
    expect(chronicleFocusProvinceIds(FILE, null)).toBeNull();
    expect(chronicleFocusProvinceIds(FILE, CHRONICLE_FOCUS_NONE)).toBeNull();
  });

  it("is null when the day pulled no nation file at all", () => {
    // Ownership is unknown here, not empty: greying the whole map over a fact
    // nothing established would misreport the day.
    expect(chronicleFocusProvinceIds(null, "alpha")).toBeNull();
  });

  it("counts occupied land as held", () => {
    const ids = chronicleFocusProvinceIds(FILE, "alpha")!;
    expect(Array.from(ids).sort()).toEqual([1, 2]);
  });

  it("includes a vassal's home provinces when the suzerain is focused", () => {
    const sworn: RegionRecord = {
      order: { rgb: "1,1,1", provinces: [1], occupied_held: [8] },
      spore: { rgb: "2,2,2", provinces: [3], overlord: "order", occupied_held: [9] },
    };
    expect(Array.from(chronicleFocusProvinceIds(sworn, "order")!).sort()).toEqual([
      1, 3, 8,
    ]);
    expect(Array.from(chronicleFocusProvinceIds(sworn, "spore")!).sort()).toEqual([
      3, 9,
    ]);
  });

  it("is empty — not null — for a realm this day has never heard of", () => {
    // Founded later or destroyed earlier. The empty set is what greys the whole
    // map for that day instead of silently un-focusing it.
    const ids = chronicleFocusProvinceIds(FILE, "atlantis");
    expect(ids).not.toBeNull();
    expect(ids!.size).toBe(0);
  });

  it("does not read a realm off the prototype chain", () => {
    // Realm ids are player-set keys, so `record["constructor"]` would otherwise
    // hand back `Object`'s member and be treated as a realm.
    for (const id of ["constructor", "toString", "__proto__"]) {
      const ids = chronicleFocusProvinceIds(FILE, id);
      expect(ids!.size).toBe(0);
    }
  });

  it("survives province lists that are not lists of province ids", () => {
    const junk = {
      a: { provinces: { "0": 1 }, occupied_held: "3,4" },
      b: { provinces: [1, -2, 0, 3.5, "6", null, 8] },
    } as unknown as RegionRecord;
    expect(chronicleFocusProvinceIds(junk, "a")!.size).toBe(0);
    expect(Array.from(chronicleFocusProvinceIds(junk, "b")!).sort()).toEqual([
      1, 8,
    ]);
  });
});

describe("focusChronicleLabels", () => {
  const labels = [label({ nationId: "alpha" }), label({ nationId: "zeta" })];

  it("hands the array straight back when nothing is focused", () => {
    expect(focusChronicleLabels(labels, null)).toBe(labels);
  });

  it("keeps only the focused realm's names", () => {
    expect(focusChronicleLabels(labels, "zeta")).toEqual([labels[1]]);
  });

  it("drops every name for a realm absent from the day", () => {
    expect(focusChronicleLabels(labels, "atlantis")).toEqual([]);
  });
});

describe("focusOwnsMarker", () => {
  it("passes every pin when nothing is focused", () => {
    expect(focusOwnsMarker("alpha", null)).toBe(true);
    expect(focusOwnsMarker(undefined, null)).toBe(true);
  });

  it("keeps only the focused realm's pins", () => {
    expect(focusOwnsMarker("alpha", "alpha")).toBe(true);
    expect(focusOwnsMarker("zeta", "alpha")).toBe(false);
  });

  it("drops an ownerless pin under a focus", () => {
    expect(focusOwnsMarker(undefined, "alpha")).toBe(false);
    expect(focusOwnsMarker("", "alpha")).toBe(false);
  });
});

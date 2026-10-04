import { describe, expect, it } from "vitest";

import type { MapObject, RegionRecord } from "@/app/components/map/types";

import { buildMapObjectsFromRegionData } from "@/app/core/mapObjectBuilder";
import { MAX_PAINTABLE_PROVINCE_ID } from "./chroniclePaint";

import {
  directOwnership,
  visibleOwnership,
} from "./chronicleOwnership";

/**
 * OVERLORD holds 1, its two vassals hold 2 and 3. That is the whole shape the
 * three functions disagree about: direct ownership keeps them apart, a visible
 * overlord rolls them together, a drilled overlord keeps only 1.
 */
const regionData: RegionRecord = {
  OVERLORD: { rgb: "10,20,30", provinces: [1], subjects: ["VASSAL_A", "VASSAL_B"] },
  VASSAL_A: { rgb: "40,50,60", provinces: [2], overlord: "OVERLORD" },
  VASSAL_B: { rgb: "70,80,90", provinces: [3], overlord: "OVERLORD" },
  LONER: { rgb: "100,110,120", provinces: [4] },
};

/**
 * A real region's own entry. `nested`/`baseId` mirror what
 * `buildMapObjectsFromRegionData` stamps on a base entry.
 */
function obj(id: string, visible: boolean): MapObject {
  return { id, visible, path: id, nested: false, baseId: id };
}

/** The synthetic drilled-in entry the builder emits for `baseId`. */
function nestedObj(baseId: string, visible: boolean): MapObject {
  return {
    id: `${baseId}_nested`,
    visible,
    path: `${baseId}_nested`,
    nested: true,
    baseId,
  };
}

describe("directOwnership", () => {
  it("paints every region's own provinces regardless of visibility", () => {
    const ownership = directOwnership(regionData);

    expect(ownership.OVERLORD).toEqual({ rgb: "10,20,30", provinces: [1] });
    expect(ownership.VASSAL_A).toEqual({ rgb: "40,50,60", provinces: [2] });
    expect(ownership.VASSAL_B).toEqual({ rgb: "70,80,90", provinces: [3] });
    expect(ownership.LONER).toEqual({ rgb: "100,110,120", provinces: [4] });
  });

  it("skips regions with no colour and survives a missing provinces array", () => {
    const ownership = directOwnership({
      NO_RGB: { provinces: [1] },
      NO_PROVINCES: { rgb: "1,2,3" },
    } as RegionRecord);

    expect(ownership.NO_RGB).toBeUndefined();
    expect(ownership.NO_PROVINCES).toEqual({ rgb: "1,2,3", provinces: [] });
  });

  it("returns a null-prototype record", () => {
    expect(Object.getPrototypeOf(directOwnership(regionData))).toBeNull();
  });

  it("survives null region data", () => {
    expect(Object.keys(directOwnership(null))).toEqual([]);
  });
});

describe("visibleOwnership", () => {
  it("rolls subjects into a visible overlord", () => {
    const ownership = visibleOwnership(regionData, [
      obj("OVERLORD", true),
      nestedObj("OVERLORD", false),
      obj("VASSAL_A", false),
      obj("VASSAL_B", false),
      obj("LONER", true),
    ]);

    expect(Object.keys(ownership).sort()).toEqual(["LONER", "OVERLORD"]);
    expect(ownership.OVERLORD!.rgb).toBe("10,20,30");
    expect([...ownership.OVERLORD!.provinces!].sort()).toEqual([1, 2, 3]);
  });

  it("does not roll up for a visible _nested entry", () => {
    const ownership = visibleOwnership(regionData, [
      obj("OVERLORD", false),
      nestedObj("OVERLORD", true),
      obj("VASSAL_A", true),
      obj("VASSAL_B", true),
    ]);

    expect(ownership.OVERLORD).toEqual({ rgb: "10,20,30", provinces: [1] });
    expect(ownership.VASSAL_A).toEqual({ rgb: "40,50,60", provinces: [2] });
    expect(ownership.VASSAL_B).toEqual({ rgb: "70,80,90", provinces: [3] });
  });

  it("contributes nothing for an invisible entry", () => {
    const ownership = visibleOwnership(regionData, [
      obj("OVERLORD", false),
      obj("LONER", false),
    ]);

    expect(Object.keys(ownership)).toEqual([]);
  });

  it("terminates on a subject cycle instead of hanging", () => {
    const cyclic: RegionRecord = {
      A: { rgb: "1,1,1", provinces: [1], subjects: ["B"] },
      B: { rgb: "2,2,2", provinces: [2], subjects: ["A"] },
    };

    const ownership = visibleOwnership(cyclic, [obj("A", true)]);
    expect([...ownership.A!.provinces!].sort()).toEqual([1, 2]);
  });

  it("survives a non-array subjects field", () => {
    const broken = {
      A: { rgb: "1,1,1", provinces: [1], subjects: "not an array" },
    } as unknown as RegionRecord;

    expect(visibleOwnership(broken, [obj("A", true)])).toMatchObject({
      A: { rgb: "1,1,1", provinces: [1] },
    });
  });

  it("does not read a region id off Object.prototype", () => {
    // "toString" is not in the day file: a plain-object read would hand back
    // the inherited function and paint a region that does not exist.
    expect(visibleOwnership(regionData, [obj("toString", true)])).toEqual(
      Object.create(null)
    );
  });

  it("keeps a __proto__ region as an own key without poisoning the output", () => {
    const poisoned = JSON.parse(
      '{"__proto__": {"rgb": "9,9,9", "provinces": [7]}}'
    ) as RegionRecord;

    const ownership = visibleOwnership(poisoned, [obj("__proto__", true)]);

    expect(Object.getPrototypeOf(ownership)).toBeNull();
    expect(Object.keys(ownership)).toEqual(["__proto__"]);
    expect(Object.values(ownership)).toEqual([{ rgb: "9,9,9", provinces: [7] }]);
    // The plain-object trap: a normal `{}` would have swallowed the assignment
    // into its prototype slot and produced no own key at all.
    expect(Object.keys({} as Record<string, unknown>)).toEqual([]);
  });

  it("survives a missing mapObjects array", () => {
    expect(Object.keys(visibleOwnership(regionData, null))).toEqual([]);
  });

  /**
   * Defect 1. Every region visible (none carries `overlord`) and chained by
   * `subjects`, so the pre-fix code walked the whole tail from every root and
   * retained N*(N+1)/2 province entries — 500 500 at N=1000, 32 million at
   * N=8000, from a file under half a megabyte.
   */
  it("keeps retained province entries linear on a visible subjects chain", () => {
    const N = 1000;
    const chain: RegionRecord = Object.create(null);
    for (let i = 0; i < N; i += 1) {
      chain[`R${i}`] = {
        rgb: "1,2,3",
        provinces: [i + 1],
        ...(i + 1 < N ? { subjects: [`R${i + 1}`] } : {}),
      };
    }

    const mapObjects = Array.from({ length: N }, (_, i) => obj(`R${i}`, true));
    const ownership = visibleOwnership(chain, mapObjects);

    const retained = Object.values(ownership).reduce(
      (total, nation) => total + (nation?.provinces?.length ?? 0),
      0
    );

    // One entry per region, not N*(N+1)/2 = 500 500.
    expect(retained).toBe(N);
    // The first root absorbs the whole chain; the rest are already visited.
    expect(ownership.R0!.provinces!.length).toBe(N);
    expect(ownership.R1!.provinces!).toEqual([]);
  });

  /**
   * Day-file keys are player-set names, so `Foo_nested` must remain distinct
   * from the synthetic drill entry for `Foo`.
   */
  it("does not confuse a real region named X_nested with X's nested entry", () => {
    const collision: RegionRecord = {
      Foo: { rgb: "10,10,10", provinces: [1, 2], subjects: ["Vassal"] },
      Vassal: { rgb: "9,9,9", provinces: [3], overlord: "Foo" },
      Foo_nested: { rgb: "200,0,0", provinces: [50, 51] },
    };

    // Exactly what the engine builds and shows for this file.
    const mapObjects = buildMapObjectsFromRegionData(
      collision as unknown as Record<string, unknown>
    );
    expect(mapObjects.map((o) => [o.id, o.visible, o.nested])).toEqual([
      ["Foo", true, false],
      ["Foo_nested", false, true],
      ["Vassal", false, false],
      ["Foo_nested", true, false],
    ]);

    const ownership = visibleOwnership(collision, mapObjects);

    // The real nation keeps its own slot, its own colour and its own land.
    expect(ownership.Foo_nested).toEqual({
      rgb: "200,0,0",
      provinces: [50, 51],
    });
    // ...and Foo is still the rolled-up overlord, not own-provinces-only.
    expect(ownership.Foo!.rgb).toBe("10,10,10");
    expect([...ownership.Foo!.provinces!].sort((a, b) => a - b)).toEqual([
      1, 2, 3,
    ]);
  });

  it("drops province ids the painter could never draw", () => {
    const junk = {
      A: {
        rgb: "1,1,1",
        provinces: [
          1,
          0,
          -5,
          1.5,
          NaN,
          "7",
          null,
          MAX_PAINTABLE_PROVINCE_ID,
          MAX_PAINTABLE_PROVINCE_ID + 1,
          2_000_000_000,
        ],
        subjects: ["B"],
      },
      B: { rgb: "2,2,2", provinces: [3, 9_999_999], overlord: "A" },
    } as unknown as RegionRecord;

    expect(visibleOwnership(junk, [obj("A", true)]).A!.provinces).toEqual([
      1,
      MAX_PAINTABLE_PROVINCE_ID,
      3,
    ]);
  });

  it("drops out-of-range ids on a drilled (own-provinces-only) entry too", () => {
    const junk = {
      A: { rgb: "1,1,1", provinces: [2, 0, 3_000_000], subjects: ["B"] },
      B: { rgb: "2,2,2", provinces: [4], overlord: "A" },
    } as unknown as RegionRecord;

    const ownership = visibleOwnership(junk, [
      obj("A", false),
      nestedObj("A", true),
      obj("B", true),
    ]);

    expect(ownership.A!.provinces).toEqual([2]);
    expect(ownership.B!.provinces).toEqual([4]);
  });
});

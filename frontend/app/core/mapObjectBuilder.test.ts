import { describe, expect, it } from "vitest";

import {
  buildMapObjectIndex,
  buildMapObjectsFromRegionData,
  initialMapObjectVisibility,
  resolveHoverTarget,
} from "./mapObjectBuilder";

const empire: Record<string, unknown> = {
  imperium: { rgb: "10,20,30", subjects: ["vassal"] },
  vassal: { rgb: "40,50,60", overlord: "imperium" },
};

describe("buildMapObjectsFromRegionData", () => {
  it("stamps structure on every entry instead of leaving it in the id", () => {
    expect(buildMapObjectsFromRegionData(empire)).toEqual([
      {
        id: "imperium",
        visible: true,
        path: "10_20_30",
        overlay: undefined,
        nested: false,
        baseId: "imperium",
      },
      {
        id: "imperium_nested",
        visible: false,
        path: "10_20_30_nested",
        overlay: undefined,
        nested: true,
        baseId: "imperium",
      },
      {
        id: "vassal",
        visible: false,
        path: "40_50_60",
        overlay: undefined,
        nested: false,
        baseId: "vassal",
      },
    ]);
  });

  it("skips regions with no rgb", () => {
    expect(buildMapObjectsFromRegionData({ ghost: {} })).toEqual([]);
  });
});

describe("initialMapObjectVisibility", () => {
  /**
   * A day file's keys are player-set names, so `Foo_nested` is a legal region.
   * The old `id.endsWith("_nested")` test forced it permanently invisible.
   */
  it("uses the nested flag, not the id suffix", () => {
    const regionData: Record<string, unknown> = {
      Foo: { rgb: "1,1,1", subjects: ["Foo_nested"] },
      Foo_nested: { rgb: "2,2,2" },
    };
    const objects = buildMapObjectsFromRegionData(regionData);

    const synthetic = objects.find((o) => o.nested)!;
    const real = objects.find((o) => o.nested === false && o.id === "Foo_nested")!;

    expect(initialMapObjectVisibility(synthetic, regionData)).toBe(false);
    expect(initialMapObjectVisibility(real, regionData)).toBe(true);
  });

  it("hides a region that has an overlord", () => {
    const objects = buildMapObjectsFromRegionData(empire);
    const vassal = objects.find((o) => o.id === "vassal")!;
    expect(initialMapObjectVisibility(vassal, empire)).toBe(false);
  });
});

describe("buildMapObjectIndex", () => {
  it("separates the real and synthetic namespaces", () => {
    const regionData: Record<string, unknown> = {
      Foo: { rgb: "1,1,1", subjects: ["Bar"] },
      Bar: { rgb: "3,3,3", overlord: "Foo" },
      Foo_nested: { rgb: "2,2,2" },
    };
    const index = buildMapObjectIndex(buildMapObjectsFromRegionData(regionData));

    // The synthetic drill entry of Foo, not the real nation named Foo_nested.
    expect(index.nested.get("Foo")!.path).toBe("1_1_1_nested");
    expect(index.base.get("Foo_nested")!.path).toBe("2_2_2");
    expect(index.nested.get("Foo_nested")).toBeUndefined();
  });

  it("survives a missing array", () => {
    expect(buildMapObjectIndex(null).base.size).toBe(0);
  });
});

describe("resolveHoverTarget", () => {
  it("walks up to the nearest visible ancestor", () => {
    const index = buildMapObjectIndex(buildMapObjectsFromRegionData(empire));
    const target = resolveHoverTarget("vassal", empire, index);

    expect(target?.regionId).toBe("imperium");
    expect(target?.object.path).toBe("10_20_30");
  });

  it("prefers the drilled nested shape when it is the visible one", () => {
    const objects = buildMapObjectsFromRegionData(empire);
    objects.find((o) => o.id === "imperium")!.visible = false;
    objects.find((o) => o.nested)!.visible = true;

    const target = resolveHoverTarget("imperium", empire, buildMapObjectIndex(objects));
    expect(target?.object.path).toBe("10_20_30_nested");
  });

  it("returns null for an unknown region", () => {
    expect(resolveHoverTarget("nobody", empire, buildMapObjectIndex([]))).toBeNull();
  });

  /**
   * Defect 2. A stored chronicle day is unvalidated JSON, so a mutual
   * `overlord` pair is a legal file. Both regions come out invisible, yet the
   * pick canvas is painted from `directOwnership` (which ignores visibility),
   * so a mousemove over their land enters this walk. Pre-fix it never
   * returned; the test times out rather than passing if the guard is removed.
   */
  it("terminates on a mutual overlord cycle instead of hanging", () => {
    const cyclic: Record<string, unknown> = {
      A: { rgb: "10,20,30", provinces: [7], overlord: "B" },
      B: { rgb: "40,50,60", provinces: [8], overlord: "A" },
    };
    const objects = buildMapObjectsFromRegionData(cyclic);
    expect(objects.every((o) => o.visible === false)).toBe(true);

    expect(resolveHoverTarget("A", cyclic, buildMapObjectIndex(objects))).toBeNull();
  }, 2000);

  it("terminates on a self-referential overlord", () => {
    const selfLoop: Record<string, unknown> = {
      A: { rgb: "1,1,1", overlord: "A" },
    };
    const objects = buildMapObjectsFromRegionData(selfLoop);
    objects[0].visible = false;

    expect(resolveHoverTarget("A", selfLoop, buildMapObjectIndex(objects))).toBeNull();
  }, 2000);

  it("ignores a non-string overlord", () => {
    const junk: Record<string, unknown> = {
      A: { rgb: "1,1,1", overlord: { toString: () => "A" } },
    };
    const objects = buildMapObjectsFromRegionData(junk);
    objects[0].visible = false;

    expect(resolveHoverTarget("A", junk, buildMapObjectIndex(objects))).toBeNull();
  });
});

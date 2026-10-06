import { describe, expect, it } from "vitest";

import type { MapMarkersResponse, RegionRecord } from "../map/types";
import {
  CHRONICLE_TOGGLES_OFF,
  anyChronicleToggleOn,
  buildChronicleLayers,
  chronicleLabelMapObjects,
  chronicleFortMarkers,
  chronicleSettlementMarkers,
  chronicleToggleSignature,
  chronicleRegionData,
  chronicleWars,
  needsMarkers,
  needsNationFile,
  needsProvinceData,
  needsProvinceGrid,
  needsTradeFile,
  paintsChronicleFill,
} from "./chronicleLayers";

const nationFile: RegionRecord = {
  suzerain: { name: "Suzerain", rgb: "10,20,30", provinces: [1, 2], subjects: ["vassal"] },
  vassal: { name: "Vassal", rgb: "40,50,60", provinces: [3], overlord: "suzerain" },
  colourless: { name: "No colour", provinces: [4] },
  landless: { name: "No land", rgb: "1,2,3", provinces: [] },
};

const markers: MapMarkersResponse = {
  map_id: "main",
  exported_at: null,
  settlements: [
    { id: "s1", name: "Placed", map_x: 100, map_y: 200 },
    { id: "s2", name: "Unplaced" },
  ],
  installations: [
    { id: "i1", name: "Harbour", kind: "port", map_x: 10, map_y: 20 },
    { id: "i2", name: "Bastion", kind: "fort", map_x: 30, map_y: 40 },
    { id: "i3", name: "Railhead", kind: "train_station", map_x: 50, map_y: 60 },
  ],
  forts: [],
  wars: [{ id: "w1", name: "The War" }],
};

describe("chronicleRegionData", () => {
  it("keeps only realms with a colour and land, like the live map does", () => {
    expect(Object.keys(chronicleRegionData(nationFile)).sort()).toEqual([
      "suzerain",
      "vassal",
    ]);
    expect(chronicleRegionData(null)).toEqual({});
  });
});

describe("chronicleLabelMapObjects", () => {
  it("hides a vassal's own label under its suzerain's", () => {
    const regionData = chronicleRegionData(nationFile);
    expect(chronicleLabelMapObjects(regionData, nationFile)).toEqual([
      // `nested`/`baseId` are stated rather than inferred from the id, so a
      // realm legitimately named `Foo_nested` is not mistaken for the drilled
      // shape of a realm named `Foo`. The studio has no drill state, so every
      // entry it emits is a real region.
      { id: "suzerain", visible: true, nested: false, baseId: "suzerain" },
      { id: "vassal", visible: false, nested: false, baseId: "vassal" },
    ]);
  });
});

describe("nation borders", () => {
  it("needs the nation file, but no markers", () => {
    const borders = { ...CHRONICLE_TOGGLES_OFF, nationBorders: true };
    expect(needsNationFile(borders)).toBe(true);
    expect(needsMarkers(borders)).toBe(false);
  });

  it("carries the computed mask only while the toggle is on", () => {
    // The very same object, not a copy: a build stores one mask per distinct
    // day, and layers must not multiply the 320 KB it costs.
    const mask = { width: 4, height: 4, bits: new Uint8Array(2) };
    const build = (nationBorders: boolean) =>
      buildChronicleLayers({
        toggles: { ...CHRONICLE_TOGGLES_OFF, nationBorders },
        markers: null,
        labels: [],
        labelObjects: [],
        borders: mask,
      }).borders;

    expect(build(true)).toBe(mask);
    expect(build(false)).toBeNull();
  });
});

describe("toggle data needs", () => {
  it("maps each toggle onto the day file it costs", () => {
    expect(needsNationFile(CHRONICLE_TOGGLES_OFF)).toBe(false);
    expect(needsMarkers(CHRONICLE_TOGGLES_OFF)).toBe(false);
    expect(
      needsNationFile({ ...CHRONICLE_TOGGLES_OFF, nationNames: true })
    ).toBe(true);
    expect(needsMarkers({ ...CHRONICLE_TOGGLES_OFF, forts: true })).toBe(true);
  });
});

describe("marker names", () => {
  const labels = [] as never[];
  const labelObjects = [{ id: "suzerain", visible: true, nested: false, baseId: "suzerain" }];
  const withMarkers = (markerNames: boolean) =>
    buildChronicleLayers({
      toggles: {
        ...CHRONICLE_TOGGLES_OFF,
        settlements: true,
        forts: true,
        markerNames,
      },
      markers,
      labels,
      labelObjects,
    });

  it("names every pin when the toggle is on", () => {
    // Installations and forts ship `showLabelOnlyOnHover: true` and a built
    // timelapse is never hovered, so without this stamp they are permanently
    // nameless while settlements beside them are labelled.
    const layers = withMarkers(true);
    expect(layers.markers.length).toBeGreaterThan(1);
    expect(
      layers.markers.every((marker) => marker.showLabelOnlyOnHover === false)
    ).toBe(true);
  });

  it("strips every name when the toggle is off, settlements included", () => {
    const layers = withMarkers(false);
    expect(layers.markers.length).toBeGreaterThan(1);
    expect(
      layers.markers.every((marker) => marker.showLabelOnlyOnHover === true)
    ).toBe(true);
  });

  it("costs no extra day file", () => {
    expect(
      needsMarkers({ ...CHRONICLE_TOGGLES_OFF, markerNames: true })
    ).toBe(false);
    expect(
      needsNationFile({ ...CHRONICLE_TOGGLES_OFF, markerNames: true })
    ).toBe(false);
  });

  it("does not on its own count as something to draw", () => {
    // It gates the "Pick a date range" button; alone it would offer to build a
    // range of empty frames.
    expect(
      anyChronicleToggleOn({ ...CHRONICLE_TOGGLES_OFF, markerNames: true })
    ).toBe(false);
    expect(
      anyChronicleToggleOn({
        ...CHRONICLE_TOGGLES_OFF,
        markerNames: true,
        forts: true,
      })
    ).toBe(true);
  });
});

describe("chronicleToggleSignature", () => {
  it("distinguishes layer sets that cost different amounts to build", () => {
    expect(chronicleToggleSignature(CHRONICLE_TOGGLES_OFF)).toBe("none");
    expect(
      chronicleToggleSignature({ ...CHRONICLE_TOGGLES_OFF, nationFill: true })
    ).toBe("nationFill");
    expect(
      chronicleToggleSignature({
        ...CHRONICLE_TOGGLES_OFF,
        nationFill: true,
        nationNames: true,
      })
    ).toBe("nationFill+nationNames");
  });

  it("does not depend on the order the toggles were switched on", () => {
    expect(
      chronicleToggleSignature({
        ...CHRONICLE_TOGGLES_OFF,
        wars: true,
        nationFill: true,
      })
    ).toBe(
      chronicleToggleSignature({
        ...CHRONICLE_TOGGLES_OFF,
        nationFill: true,
        wars: true,
      })
    );
  });
});

describe("buildChronicleLayers", () => {
  const labels = [{ nationId: "suzerain" }] as never[];
  const labelObjects = [{ id: "suzerain", visible: true, nested: false, baseId: "suzerain" }];

  it("renders nothing while every toggle is off", () => {
    const layers = buildChronicleLayers({
      toggles: CHRONICLE_TOGGLES_OFF,
      markers,
      labels,
      labelObjects,
    });
    expect(layers).toEqual({
      labels: [],
      borders: null,
      occupationSeam: null,
      fortControl: null,
      markers: [],
      wars: [],
    });
  });

  it("splits forts out of the settlement layer", () => {
    const settlementLayer = buildChronicleLayers({
      toggles: { ...CHRONICLE_TOGGLES_OFF, settlements: true },
      markers,
      labels,
      labelObjects,
    });
    expect(settlementLayer.markers.map((marker) => marker.id)).toEqual([
      "s1",
      "installation:i1",
      "installation:i3",
    ]);

    const fortLayer = buildChronicleLayers({
      toggles: { ...CHRONICLE_TOGGLES_OFF, forts: true },
      markers,
      labels,
      labelObjects,
    });
    expect(fortLayer.markers.map((marker) => marker.id)).toEqual([
      "installation:i2",
    ]);
  });

  it("only carries wars when the war toggle is on", () => {
    expect(
      buildChronicleLayers({
        toggles: { ...CHRONICLE_TOGGLES_OFF, wars: true },
        markers,
        labels,
        labelObjects,
      }).wars
    ).toHaveLength(1);
    expect(
      buildChronicleLayers({
        toggles: { ...CHRONICLE_TOGGLES_OFF, settlements: true },
        markers,
        labels,
        labelObjects,
      }).wars
    ).toEqual([]);
  });

  it("passes labels through only when names are on", () => {
    expect(
      buildChronicleLayers({
        toggles: { ...CHRONICLE_TOGGLES_OFF, nationNames: true },
        markers: null,
        labels,
        labelObjects,
      }).labels
    ).toBe(labels);
  });
});

describe("chronicleRegionData against a hostile day file", () => {
  it("does not let a __proto__ realm hijack the map it is collected into", () => {
    // `JSON.parse` makes `__proto__` a real own property, so `Object.entries`
    // yields it and `out[id] = region` on a plain object would call
    // `Object.prototype.__proto__`'s setter: the realm silently vanishes from
    // the label layer while `buildNationColorLut` still paints its provinces,
    // and the map then answers truthily for keys it never had.
    const hostile = JSON.parse(
      '{"__proto__":{"rgb":"1,2,3","provinces":[9]},"Real":{"rgb":"4,5,6","provinces":[1]}}'
    ) as RegionRecord;

    const out = chronicleRegionData(hostile);

    expect(Object.keys(out).sort()).toEqual(["Real", "__proto__"]);
    expect(Object.getPrototypeOf(out)).toBeNull();
    // The hijack's tell: an unrelated key resolving through the injected object.
    expect((out as Record<string, unknown>).rgb).toBeUndefined();
    expect((out as Record<string, unknown>).missingRealm).toBeUndefined();
    // Scoped to this object either way, but assert the realm nothing did.
    expect(({} as Record<string, unknown>).rgb).toBeUndefined();
  });

  it("keeps the fill and the labels agreeing on which realms exist", () => {
    // `buildNationColorLut` reads the same file with `Object.values`, so any
    // realm this drops is one that gets painted with no label over it.
    const hostile = JSON.parse(
      '{"__proto__":{"rgb":"1,2,3","provinces":[9]},"Real":{"rgb":"4,5,6","provinces":[1]}}'
    ) as RegionRecord;

    expect(Object.keys(chronicleRegionData(hostile))).toHaveLength(
      Object.values(hostile).length
    );
  });
});

describe("marker layers against malformed day payloads", () => {
  // `?? []` only handles null and undefined: `"settlements": {}` can still
  // reach `.filter` inside a render-time `useMemo`. There is no error boundary
  // to contain that throw, so non-arrays must become missing data first.
  const malformed = {
    map_id: "main",
    exported_at: null,
    settlements: {},
    installations: "nope",
    forts: [],
    wars: { id: "w1" },
  } as unknown as MapMarkersResponse;

  it("treats a non-array settlements payload as an empty day", () => {
    expect(chronicleSettlementMarkers(malformed, [])).toEqual([]);
  });

  it("treats a non-array installations payload as an empty day", () => {
    expect(chronicleFortMarkers(malformed)).toEqual([]);
  });

  it("treats a non-array wars payload as an empty day", () => {
    expect(chronicleWars(malformed)).toEqual([]);
    expect(chronicleWars(null)).toEqual([]);
    expect(
      chronicleWars({ map_id: "main" } as unknown as MapMarkersResponse)
    ).toEqual([]);
  });

  it("builds a whole layer set from a malformed day without throwing", () => {
    const layers = buildChronicleLayers({
      toggles: {
        ...CHRONICLE_TOGGLES_OFF,
        settlements: true,
        forts: true,
        wars: true,
      },
      markers: malformed,
      labels: [],
      labelObjects: [],
    });

    expect(layers).toEqual({
      labels: [],
      borders: null,
      occupationSeam: null,
      fortControl: null,
      markers: [],
      wars: [],
    });
  });
});

describe("occupation and fort control", () => {
  const mask = () => ({ width: 4, height: 4, bits: new Uint8Array(2) });

  it("maps each onto the day file it costs", () => {
    expect(
      needsNationFile({ ...CHRONICLE_TOGGLES_OFF, occupation: true })
    ).toBe(true);
    expect(needsMarkers({ ...CHRONICLE_TOGGLES_OFF, occupation: true })).toBe(
      false
    );
    // `zoc_provinces` rides on the fort rows of the markers payload the forts
    // toggle already pulls, so fort control costs no extra day file.
    expect(
      needsMarkers({ ...CHRONICLE_TOGGLES_OFF, fortControl: true })
    ).toBe(true);
    expect(
      needsNationFile({ ...CHRONICLE_TOGGLES_OFF, fortControl: true })
    ).toBe(false);
  });

  it("each counts as something to draw on its own", () => {
    // Unlike `markerNames`: both of these paint their own marks with every
    // other layer off, so gating the range step on them is correct.
    expect(
      anyChronicleToggleOn({ ...CHRONICLE_TOGGLES_OFF, occupation: true })
    ).toBe(true);
    expect(
      anyChronicleToggleOn({ ...CHRONICLE_TOGGLES_OFF, fortControl: true })
    ).toBe(true);
  });

  it("carries each computed mask only while its own toggle is on", () => {
    // The very same objects, not copies: a build stores one mask per distinct
    // day and layers must not multiply what they cost.
    const occupationSeam = mask();
    const fortControl = mask();
    const build = (toggles: Partial<typeof CHRONICLE_TOGGLES_OFF>) =>
      buildChronicleLayers({
        toggles: { ...CHRONICLE_TOGGLES_OFF, ...toggles },
        markers: null,
        labels: [],
        labelObjects: [],
        occupationSeam,
        fortControl,
      });

    expect(build({ occupation: true }).occupationSeam).toBe(occupationSeam);
    expect(build({ occupation: true }).fortControl).toBeNull();
    expect(build({ fortControl: true }).fortControl).toBe(fortControl);
    expect(build({ fortControl: true }).occupationSeam).toBeNull();
    expect(build({}).occupationSeam).toBeNull();
  });

  it("keeps them out of a signature that did not switch them on", () => {
    expect(
      chronicleToggleSignature({
        ...CHRONICLE_TOGGLES_OFF,
        occupation: true,
        fortControl: true,
      })
    ).toBe("occupation+fortControl");
  });
});

describe("trade leagues and prosperity", () => {
  it("each costs its own day file and nothing else's", () => {
    // `trade` and `province_data` are separate captures: a day can be missing
    // one and intact in the other, and neither must drag the nation file along.
    const leagues = { ...CHRONICLE_TOGGLES_OFF, tradeLeagues: true };
    expect(needsTradeFile(leagues)).toBe(true);
    expect(needsProvinceData(leagues)).toBe(false);
    expect(needsNationFile(leagues)).toBe(false);
    expect(needsMarkers(leagues)).toBe(false);

    const heat = { ...CHRONICLE_TOGGLES_OFF, prosperity: true };
    expect(needsProvinceData(heat)).toBe(true);
    expect(needsTradeFile(heat)).toBe(false);
    expect(needsNationFile(heat)).toBe(false);
    expect(needsMarkers(heat)).toBe(false);
  });

  it("neither file is pulled while its toggle is off", () => {
    expect(needsTradeFile(CHRONICLE_TOGGLES_OFF)).toBe(false);
    expect(needsProvinceData(CHRONICLE_TOGGLES_OFF)).toBe(false);
    // Nation layers must not start dragging two new sources with them.
    const nations = {
      ...CHRONICLE_TOGGLES_OFF,
      nationFill: true,
      nationBorders: true,
      occupation: true,
      nationNames: true,
    };
    expect(needsTradeFile(nations)).toBe(false);
    expect(needsProvinceData(nations)).toBe(false);
  });

  it("each needs the province grid, since each paints provinces", () => {
    expect(
      needsProvinceGrid({ ...CHRONICLE_TOGGLES_OFF, tradeLeagues: true })
    ).toBe(true);
    expect(
      needsProvinceGrid({ ...CHRONICLE_TOGGLES_OFF, prosperity: true })
    ).toBe(true);
  });

  it("each counts as something to draw on its own", () => {
    // Unlike `markerNames`: both paint their own marks with every other layer
    // off — league territory on bare parchment, the heat wash over the map.
    expect(
      anyChronicleToggleOn({ ...CHRONICLE_TOGGLES_OFF, tradeLeagues: true })
    ).toBe(true);
    expect(
      anyChronicleToggleOn({ ...CHRONICLE_TOGGLES_OFF, prosperity: true })
    ).toBe(true);
  });

  it("costs one pixel pass however many fill layers are on", () => {
    // All four composite into the frame's single colour table, so the estimate
    // must charge the paint once rather than once per layer.
    expect(paintsChronicleFill(CHRONICLE_TOGGLES_OFF)).toBe(false);
    for (const key of [
      "nationFill",
      "occupation",
      "tradeLeagues",
      "prosperity",
    ] as const) {
      expect(paintsChronicleFill({ ...CHRONICLE_TOGGLES_OFF, [key]: true })).toBe(
        true
      );
    }
    // Layers that draw somewhere other than the fill canvas do not light it up.
    expect(
      paintsChronicleFill({
        ...CHRONICLE_TOGGLES_OFF,
        nationBorders: true,
        nationNames: true,
        fortControl: true,
      })
    ).toBe(false);
  });

  it("changes the layer set a timing may be quoted for", () => {
    // A build with the heat map on pulls an extra day file per day; a sample
    // measured without it must not be reported as measuring it.
    expect(
      chronicleToggleSignature({
        ...CHRONICLE_TOGGLES_OFF,
        nationFill: true,
        tradeLeagues: true,
        prosperity: true,
      })
    ).toBe("nationFill+tradeLeagues+prosperity");
    expect(
      chronicleToggleSignature({ ...CHRONICLE_TOGGLES_OFF, nationFill: true })
    ).not.toBe(
      chronicleToggleSignature({
        ...CHRONICLE_TOGGLES_OFF,
        nationFill: true,
        prosperity: true,
      })
    );
  });

  it("adds no overlay to the frame layers, because both ride in the fill", () => {
    // The whole reason `ChronicleFrameLayers` is untouched by these two: they
    // are composited into the frame's one `ImageBitmap` rather than carried as
    // separate overlays, which is also what puts them in the GIF for free.
    expect(
      buildChronicleLayers({
        toggles: {
          ...CHRONICLE_TOGGLES_OFF,
          tradeLeagues: true,
          prosperity: true,
        },
        markers,
        labels: [],
        labelObjects: [],
      })
    ).toEqual({
      labels: [],
      borders: null,
      occupationSeam: null,
      fortControl: null,
      markers: [],
      wars: [],
    });
  });
});

describe("buildChronicleLayers under a focus", () => {
  const owned: MapMarkersResponse = {
    map_id: "main",
    exported_at: null,
    settlements: [
      { id: "s-ours", name: "Ours", faction_id: "suzerain", map_x: 1, map_y: 1 },
      { id: "s-theirs", name: "Theirs", faction_id: "vassal", map_x: 2, map_y: 2 },
      { id: "s-nobody", name: "Nobody", map_x: 3, map_y: 3 },
    ],
    installations: [
      {
        id: "i-ours",
        name: "Harbour",
        kind: "port",
        faction_id: "suzerain",
        map_x: 4,
        map_y: 4,
      },
      {
        id: "i-theirs",
        name: "Bastion",
        kind: "fort",
        faction_id: "vassal",
        map_x: 5,
        map_y: 5,
      },
      {
        id: "i-fort",
        name: "Keep",
        kind: "fort",
        faction_id: "suzerain",
        map_x: 6,
        map_y: 6,
      },
    ],
    forts: [],
    wars: [{ id: "w1", name: "The War" }],
  };
  const labels = [
    { nationId: "suzerain" },
    { nationId: "vassal" },
  ] as never[];
  const labelObjects = [{ id: "suzerain", visible: true, nested: false, baseId: "suzerain" }];

  it("keeps only the focused realm's names and pins", () => {
    const layers = buildChronicleLayers({
      toggles: {
        ...CHRONICLE_TOGGLES_OFF,
        nationNames: true,
        settlements: true,
        forts: true,
      },
      markers: owned,
      labels,
      labelObjects,
      focusNationId: "suzerain",
    });
    expect(layers.labels).toEqual([{ nationId: "suzerain" }]);
    expect(layers.markers.map((marker) => marker.id)).toEqual([
      "s-ours",
      "installation:i-ours",
      "installation:i-fort",
    ]);
  });

  it("keeps a vassal's pins when the focused suzerain's nation file is in hand", () => {
    const layers = buildChronicleLayers({
      toggles: {
        ...CHRONICLE_TOGGLES_OFF,
        settlements: true,
        forts: true,
      },
      markers: owned,
      labels,
      labelObjects,
      focusNationId: "suzerain",
      nationFile,
    });
    expect(layers.markers.map((marker) => marker.id)).toEqual([
      "s-ours",
      "s-theirs",
      "installation:i-ours",
      "installation:i-theirs",
      "installation:i-fort",
    ]);
  });

  it("keeps campaign lines and battle pins whole", () => {
    // `WarExport` names its sides by leader id, not by realm, so there is no
    // field to narrow a war on; showing them all beats guessing wrong.
    const layers = buildChronicleLayers({
      toggles: { ...CHRONICLE_TOGGLES_OFF, wars: true },
      markers: owned,
      labels,
      labelObjects,
      focusNationId: "suzerain",
    });
    expect(layers.wars).toHaveLength(1);
  });

  it("empties the frame for a realm the day never had", () => {
    const layers = buildChronicleLayers({
      toggles: {
        ...CHRONICLE_TOGGLES_OFF,
        nationNames: true,
        settlements: true,
      },
      markers: owned,
      labels,
      labelObjects,
      focusNationId: "atlantis",
    });
    expect(layers.labels).toEqual([]);
    expect(layers.markers).toEqual([]);
  });

  it("changes nothing at all with no focus set", () => {
    const toggles = {
      ...CHRONICLE_TOGGLES_OFF,
      nationNames: true,
      settlements: true,
      forts: true,
    };
    const base = buildChronicleLayers({
      toggles,
      markers: owned,
      labels,
      labelObjects,
    });
    expect(
      buildChronicleLayers({
        toggles,
        markers: owned,
        labels,
        labelObjects,
        focusNationId: null,
      })
    ).toEqual(base);
    expect(base.labels).toBe(labels);
  });
});

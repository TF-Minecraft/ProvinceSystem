import { describe, expect, it } from "vitest";

import {
  LABEL_MIN_INSET_PX,
  LABEL_GLYPH_WIDTH_EM,
  buildComponentMask,
  componentSubRect,
  corridorClear,
  distanceTransform,
  findLabelAnchor,
  insetLabelEndpoints,
  isLabelCorridorWaterCell,
  labelCorridorMargin,
  LongestFirstPairs,
  parseProvinceLabelGrid,
  tryRadialSegment,
  type ProvinceLabelGrid,
} from "./labelBlobGeometry";

function segmentPixelLength(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function makeGrid(
  width: number,
  height: number,
  cells: number[],
  mapWidth = width * 10,
  mapHeight = height * 10
): ProvinceLabelGrid {
  return {
    mapWidth,
    mapHeight,
    gridWidth: width,
    gridHeight: height,
    cells: new Uint16Array(cells),
    scaleX: mapWidth / width,
    scaleY: mapHeight / height,
  };
}

describe("labelCorridorMargin", () => {
  it("uses at least LABEL_MIN_INSET_PX", () => {
    expect(labelCorridorMargin(100, 10)).toBeGreaterThanOrEqual(LABEL_MIN_INSET_PX);
  });

  it("grows with segment length and font size", () => {
    const small = labelCorridorMargin(200, 20);
    const large = labelCorridorMargin(600, 40);
    expect(large).toBeGreaterThan(small);
  });
});

describe("distanceTransform", () => {
  it("gives higher clearance in the interior of a solid block", () => {
    const grid = makeGrid(
      5,
      5,
      [
        1, 1, 1, 1, 1,
        1, 1, 1, 1, 1,
        1, 1, 1, 1, 1,
        1, 1, 1, 1, 1,
        1, 1, 1, 1, 1,
      ]
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const center = dist[2 * grid.gridWidth + 2];
    const edge = dist[2 * grid.gridWidth + 0];
    expect(center).toBeGreaterThan(edge);
  });

  it("gives high clearance on riverbanks when only water is adjacent", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const riverbank = dist[1 * grid.gridWidth + 1];
    expect(riverbank).toBe(Number.POSITIVE_INFINITY);
  });

  it("gives low clearance on land adjacent to foreign territory", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 2, 2, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const foreignShore = dist[1 * grid.gridWidth + 3];
    const interior = dist[1 * grid.gridWidth + 1];
    expect(foreignShore).toBeLessThan(LABEL_MIN_INSET_PX);
    expect(interior).toBeGreaterThan(foreignShore);
  });
});

describe("corridorClear", () => {
  it("allows a long chord that extends over crossable water beyond owned land", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const len = 60;
    const fontSize = Math.round(len / (2 * LABEL_GLYPH_WIDTH_EM));

    expect(
      corridorClear(5, 15, 65, 15, labelCorridorMargin(len, fontSize), grid, dist)
    ).toBe(true);
    expect(corridorClear(15, 15, 55, 15, 10, grid, dist)).toBe(true);
  });

  it("allows a long chord along a riverbank at full margin", () => {
    const grid = makeGrid(
      11,
      3,
      [
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ],
      110,
      30
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const len = 90;
    const fontSize = Math.round(len / (4 * LABEL_GLYPH_WIDTH_EM));

    expect(
      corridorClear(15, 15, 95, 15, labelCorridorMargin(len, fontSize), grid, dist)
    ).toBe(true);
  });

  it("allows a chord that crosses crossable gaps between the same province", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 1, 1, 0, 0, 1, 0,
        0, 1, 1, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    expect(isLabelCorridorWaterCell(grid, 3)).toBe(true);
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);

    expect(corridorClear(15, 15, 55, 15, 10, grid, dist)).toBe(true);
  });

  it("still rejects a chord that crosses foreign land", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 1, 1, 2, 2, 1, 0,
        0, 1, 1, 2, 2, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const len = 50;
    const fontSize = Math.round(len / (2 * LABEL_GLYPH_WIDTH_EM));

    expect(
      corridorClear(15, 15, 55, 15, labelCorridorMargin(len, fontSize), grid, dist)
    ).toBe(false);
  });

  it("rejects a chord that crosses a sea province cell", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 1, 1, 99, 99, 1, 0,
        0, 1, 1, 99, 99, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    expect(isLabelCorridorWaterCell(grid, 3)).toBe(false);
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const len = 50;
    const fontSize = Math.round(len / (2 * LABEL_GLYPH_WIDTH_EM));

    expect(
      corridorClear(15, 15, 55, 15, labelCorridorMargin(len, fontSize), grid, dist)
    ).toBe(false);
  });
});

describe("insetLabelEndpoints", () => {
  it("returns a short radial label on a tiny square blob", () => {
    const grid = makeGrid(3, 3, [1, 1, 1, 1, 1, 1, 1, 1, 1], 30, 30);
    const seed = { x1: 15, y1: 15, x2: 15, y2: 15 };
    const endpoints = insetLabelEndpoints([1], "Tiny", grid, seed);
    expect(endpoints).not.toBeNull();
    expect(
      segmentPixelLength(endpoints!.x1, endpoints!.y1, endpoints!.x2, endpoints!.y2)
    ).toBeGreaterThan(0);
  });

  it("uses radial fallback for a single-province strip", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 1, 1, 1, 1, 1, 0,
        0, 1, 1, 1, 1, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const seed = { x1: 35, y1: 15, x2: 35, y2: 15 };
    const endpoints = insetLabelEndpoints([1], "Realm", grid, seed);
    expect(endpoints).not.toBeNull();
    expect(endpoints!.x2 - endpoints!.x1).toBeGreaterThan(20);
  });

  it("can span across water when seed endpoints bridge two land masses", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 1, 1, 0, 0, 1, 0,
        0, 1, 1, 0, 0, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const seed = { x1: 15, y1: 15, x2: 55, y2: 15 };
    const endpoints = insetLabelEndpoints([1], "Realm", grid, seed);
    expect(endpoints).not.toBeNull();
    expect(endpoints!.x2 - endpoints!.x1).toBeGreaterThan(30);
  });
});

describe("tryRadialSegment", () => {
  it("places a vertical label on a narrow strip", () => {
    const grid = makeGrid(
      3,
      7,
      [
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 0, 0,
      ],
      30,
      70
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const anchor = findLabelAnchor(mask, dist, grid);
    expect(anchor).not.toBeNull();

    const endpoints = tryRadialSegment(mask, dist, grid, "Isle", 1, anchor!);
    expect(endpoints).not.toBeNull();
    expect(
      Math.abs(endpoints!.y2 - endpoints!.y1)
    ).toBeGreaterThan(Math.abs(endpoints!.x2 - endpoints!.x1));
  });

  it("rejects segments that would cross foreign land", () => {
    const grid = makeGrid(
      7,
      3,
      [
        0, 1, 1, 2, 2, 1, 0,
        0, 1, 1, 2, 2, 1, 0,
        0, 0, 0, 0, 0, 0, 0,
      ],
      70,
      30
    );
    const mask = buildComponentMask(grid, [1]);
    const dist = distanceTransform(mask, grid);
    const anchor = findLabelAnchor(mask, dist, grid)!;
    const endpoints = tryRadialSegment(mask, dist, grid, "Realm", 1, anchor);
    expect(endpoints).not.toBeNull();
    expect(
      corridorClear(
        endpoints!.x1,
        endpoints!.y1,
        endpoints!.x2,
        endpoints!.y2,
        10,
        grid,
        dist
      )
    ).toBe(true);
    expect(endpoints!.x2 - endpoints!.x1).toBeLessThan(35);
  });
});

describe("parseProvinceLabelGrid", () => {
  it("parses uint16 cells from a binary buffer", () => {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setUint16(0, 5, true);
    view.setUint16(2, 9, true);
    view.setUint16(4, 0, true);
    view.setUint16(6, 12, true);

    const grid = parseProvinceLabelGrid(
      { mapWidth: 40, mapHeight: 20, gridWidth: 2, gridHeight: 2 },
      buffer
    );

    expect(Array.from(grid.cells)).toEqual([5, 9, 0, 12]);
    expect(grid.scaleX).toBe(20);
    expect(grid.scaleY).toBe(10);
  });
});

describe("sub-rect restriction", () => {
  /**
   * Full-grid reference for the forbidden-only distance transform.
   */
  function referenceDistanceTransform(
    mask: Uint8Array,
    grid: ProvinceLabelGrid
  ): Float32Array {
    return distanceTransform(mask, grid);
  }

  /**
   * 24x24 grid, map scale 8px/cell so the sub-rect padding
   * (LABEL_MIN_INSET_PX / cellScale = 5 cells) does not swallow the grid.
   */
  function scenarioGrid(): ProvinceLabelGrid {
    const w = 24;
    const h = 24;
    const cells = new Array<number>(w * h).fill(0);
    const paint = (id: number, x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) cells[y * w + x] = id;
      }
    };
    // 1: fully interior blob
    paint(1, 9, 9, 14, 14);
    // 2: blob flush against the left + top TRUE grid edges
    paint(2, 0, 0, 5, 5);
    // 3: blob flush against the right + bottom TRUE grid edges
    paint(3, 18, 18, 23, 23);
    // 4: neighbouring land so blobs are not surrounded purely by water
    paint(4, 6, 9, 8, 14);
    return {
      mapWidth: w * 8,
      mapHeight: h * 8,
      gridWidth: w,
      gridHeight: h,
      cells: new Uint16Array(cells),
      scaleX: 8,
      scaleY: 8,
    };
  }

  const grid = scenarioGrid();

  it.each([[1], [2], [3], [4]])(
    "sub-rect mask + distance transform match the full-grid result (province %i)",
    (id) => {
      const rect = componentSubRect(grid, [id])!;
      expect(rect).not.toBeNull();

      const fullMask = buildComponentMask(grid, [id]);
      const rectMask = buildComponentMask(grid, [id], rect);
      expect(Array.from(rectMask)).toEqual(Array.from(fullMask));

      const reference = referenceDistanceTransform(fullMask, grid);
      const restricted = distanceTransform(rectMask, grid, rect);
      expect(Array.from(restricted)).toEqual(Array.from(reference));
    }
  );

  it("keeps clearance-0 seeding on TRUE grid edges", () => {
    // Province 2 sits on the left/top grid edges: its edge cells must be 0.
    const rect = componentSubRect(grid, [2])!;
    const mask = buildComponentMask(grid, [2], rect);
    const dist = distanceTransform(mask, grid, rect);
    expect(dist[0 * grid.gridWidth + 3]).toBe(0);
    expect(dist[3 * grid.gridWidth + 0]).toBe(0);
  });

  it("does NOT seed clearance-0 on sub-rect borders interior to the grid", () => {
    // Province 1 is fully interior. Its sub-rect borders are ordinary grid
    // cells; if they were treated as edges the blob interior would lose
    // clearance relative to the unrestricted transform.
    const rect = componentSubRect(grid, [1])!;
    expect(rect.x0).toBeGreaterThan(0);
    expect(rect.y0).toBeGreaterThan(0);

    const mask = buildComponentMask(grid, [1], rect);
    const restricted = distanceTransform(mask, grid, rect);
    const reference = referenceDistanceTransform(
      buildComponentMask(grid, [1]),
      grid
    );
    const center = 12 * grid.gridWidth + 12;
    expect(restricted[center]).toBe(reference[center]);
    expect(restricted[center]).toBeGreaterThan(0);
  });

  it("returns null for province ids absent from the grid", () => {
    expect(componentSubRect(grid, [9999])).toBeNull();
  });

  it("pads the sub-rect beyond the raw province bounds", () => {
    const rect = componentSubRect(grid, [1])!;
    expect(rect.x0).toBeLessThan(9);
    expect(rect.x1).toBeGreaterThan(14);
  });
});

describe("LongestFirstPairs", () => {
  it("hands out pairs exactly as a stable longest-first sort would", () => {
    // A grid of points gives plenty of equal lengths, so ties are exercised.
    const candidates = [];
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 7; x += 1) candidates.push({ x: x * 10, y: y * 10 });
    }
    const pairs = new LongestFirstPairs(candidates);
    const expected = [...Array(pairs.count).keys()].sort(
      (left, right) => pairs.len[right] - pairs.len[left]
    );
    const actual = expected.map((_, k) => pairs.at(k));
    expect(actual).toEqual(expected);
    expect(pairs.at(pairs.count)).toBe(-1);
  });
});

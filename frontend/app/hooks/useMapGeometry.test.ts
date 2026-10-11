import { describe, expect, it } from "vitest";

import { chronicleNamesSupported, mapGeometryDataPaths } from "./useMapGeometry";

const GEOMETRY_FILES = [
  "province_neighbors",
  "province_label_neighbors",
  "province_centroids",
  "province_label_grid",
  "province_label_grid_bin",
] as const;

describe("mapGeometryDataPaths", () => {
  it("builds the five data paths for any map id", () => {
    for (const mapId of ["dev", "calavorn"] as const) {
      const paths = mapGeometryDataPaths(mapId);
      expect(paths).toEqual(GEOMETRY_FILES.map((name) => `/${mapId}/data/${name}`));
    }
  });
});

describe("chronicleNamesSupported", () => {
  it("stays true while geometry is still loading", () => {
    expect(
      chronicleNamesSupported({
        ready: false,
        neighbors: null,
        centroids: null,
      }),
    ).toBe(true);
  });

  it("is false after ready when neighbor or centroid files are missing", () => {
    expect(
      chronicleNamesSupported({
        ready: true,
        neighbors: null,
        centroids: null,
      }),
    ).toBe(false);
    expect(
      chronicleNamesSupported({
        ready: true,
        neighbors: { "1": [] },
        centroids: null,
      }),
    ).toBe(false);
  });

  it("is true after ready when both graphs loaded", () => {
    expect(
      chronicleNamesSupported({
        ready: true,
        neighbors: { "1": [2] },
        centroids: { "1": { x: 1, y: 1 } },
      }),
    ).toBe(true);
  });
});

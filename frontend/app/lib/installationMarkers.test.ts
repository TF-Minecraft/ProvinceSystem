import { describe, expect, it } from "vitest";

import {
  filterPlacedInstallations,
  installationToMapMarker,
} from "./installationMarkers";

describe("installationMarkers", () => {
  it("filterPlacedInstallations keeps only finite map coords", () => {
    const out = filterPlacedInstallations([
      {
        id: "a",
        name: "A",
        kind: "fort",
        map_x: 1,
        map_y: 2,
      },
      {
        id: "b",
        name: "B",
        kind: "port",
        map_x: undefined,
        map_y: 2,
      },
      {
        id: "c",
        name: "C",
        kind: "train_station",
        map_x: 3,
        map_y: 4,
      },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe("a");
    expect(out[1].kind).toBe("train_station");
  });

  it("installationToMapMarker prefixes id and sets small size", () => {
    const marker = installationToMapMarker({
      id: "lanhold",
      name: "Lanhold",
      kind: "fort",
      map_x: 100,
      map_y: 200,
    });
    expect(marker.id).toBe("installation:lanhold");
    expect(marker.kind).toBe("fort");
    expect(marker.markerSize).toBe("small");
    expect(marker.mapX).toBe(100);
    expect(marker.mapY).toBe(200);
    expect(marker.title).toBe("Lanhold (Fort)");
    expect(marker.showLabelOnlyOnHover).toBe(true);
  });
});

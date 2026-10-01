import { describe, expect, it } from "vitest";

import type { FortMarker } from "../components/map/types";
import type { MapMarker } from "./mapMarkers";
import {
  installationIdFromMarkerId,
  lookupFortZocOverlay,
} from "./fortZoc";

const fortMarker: MapMarker = {
  id: "installation:lanhold",
  kind: "fort",
  mapX: 100,
  mapY: 200,
  label: "Lanhold",
  title: "Lanhold (Fort)",
  showLabelOnlyOnHover: true,
};

const forts: FortMarker[] = [
  {
    id: "lanhold",
    name: "Lanhold",
    overlay: { x: 10, y: 20, w: 30, h: 40 },
    zoc_url: "/main/zoc/lanhold.png",
  },
];

describe("installationIdFromMarkerId", () => {
  it("parses installation marker ids", () => {
    expect(installationIdFromMarkerId("installation:lanhold")).toBe("lanhold");
  });

  it("returns null for non-installation marker ids", () => {
    expect(installationIdFromMarkerId("settlement:rivendell")).toBeNull();
    expect(installationIdFromMarkerId("installation:")).toBeNull();
  });
});

describe("lookupFortZocOverlay", () => {
  it("returns overlay for fort markers with matching fort row", () => {
    expect(lookupFortZocOverlay(fortMarker, forts)).toEqual({
      url: "/main/zoc/lanhold.png",
      overlay: { x: 10, y: 20, w: 30, h: 40 },
    });
  });

  it("returns null for non-fort installation markers", () => {
    const portMarker: MapMarker = { ...fortMarker, kind: "port" };
    const airportMarker: MapMarker = { ...fortMarker, kind: "airport" };
    const trainStationMarker: MapMarker = { ...fortMarker, kind: "train_station" };

    expect(lookupFortZocOverlay(portMarker, forts)).toBeNull();
    expect(lookupFortZocOverlay(airportMarker, forts)).toBeNull();
    expect(lookupFortZocOverlay(trainStationMarker, forts)).toBeNull();
  });

  it("returns null when fort row is missing overlay or zoc_url", () => {
    expect(
      lookupFortZocOverlay(fortMarker, [{ id: "lanhold", zoc_url: "/main/zoc/lanhold.png" }])
    ).toBeNull();
    expect(
      lookupFortZocOverlay(fortMarker, [
        { id: "lanhold", overlay: { x: 1, y: 2, w: 3, h: 4 } },
      ])
    ).toBeNull();
  });

  it("returns null when marker id is not an installation marker", () => {
    const marker: MapMarker = { ...fortMarker, id: "fort:lanhold" };
    expect(lookupFortZocOverlay(marker, forts)).toBeNull();
  });
});

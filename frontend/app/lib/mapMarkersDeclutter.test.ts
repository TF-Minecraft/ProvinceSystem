import { describe, expect, it } from "vitest";

import {
  hiddenMarkerLabels,
  markerDimensions,
  pickMapMarkerAt,
  type MapMarker,
} from "./mapMarkers";

const pin = (id: string, x: number, y: number, extra: Partial<MapMarker> = {}): MapMarker => ({
  id,
  kind: "settlement",
  markerSize: "small",
  mapX: x,
  mapY: y,
  label: id,
  title: id,
  ...extra,
});

// 0.3 screen px per map px: every marker visible, labels a sensible size.
const SCALE = 0.3;

describe("hiddenMarkerLabels", () => {
  it("keeps every label when nothing overlaps", () => {
    const markers = [pin("Alpha", 0, 0), pin("Bravo", 3000, 3000)];
    expect(hiddenMarkerLabels(markers, SCALE).size).toBe(0);
  });

  it("lets the capital's name win over a settlement's", () => {
    const markers = [
      pin("Prospero", 1000, 1000),
      pin("The Guildhouse", 1010, 1000, { kind: "faction_capital", markerSize: "large" }),
    ];
    expect([...hiddenMarkerLabels(markers, SCALE)]).toEqual(["Prospero"]);
  });

  it("breaks a tie by population", () => {
    const markers = [
      pin("Small", 1000, 1000, { weight: 3 }),
      pin("Bigger", 1000, 1020, { weight: 9 }),
    ];
    expect([...hiddenMarkerLabels(markers, SCALE)]).toEqual(["Small"]);
  });

  it("brings names back when zoomed in far enough", () => {
    const markers = [pin("Prospero", 1000, 1000), pin("Guildhouse", 1100, 1000, { markerSize: "large" })];
    expect(hiddenMarkerLabels(markers, SCALE).size).toBe(1);
    expect(hiddenMarkerLabels(markers, 4).size).toBe(0);
  });

  it("ignores hover-only labels (installations)", () => {
    const markers = [
      pin("Town", 1000, 1000),
      pin("Port", 1005, 1000, { kind: "port", showLabelOnlyOnHover: true }),
    ];
    // The port's pin still blocks the town's name, but the port has no label to hide.
    expect(hiddenMarkerLabels(markers, SCALE).has("Port")).toBe(false);
  });

  it("does not hit-test a hidden label, only its pin", () => {
    const markers = [pin("Prospero", 1000, 1000), pin("Guildhouse", 1010, 1000, { markerSize: "large" })];
    const hidden = hiddenMarkerLabels(markers, SCALE);
    // A point in Prospero's would-be label area, well clear of both pins.
    const labelY = 1000 + markerDimensions("small").size / 2 + 20;
    expect(pickMapMarkerAt([markers[0]], 1000, labelY, SCALE)?.id).toBe("Prospero");
    expect(pickMapMarkerAt([markers[0]], 1000, labelY, SCALE, hidden)).toBeNull();
  });
});

describe("marker sizes", () => {
  it("sets a guild seat's name between a settlement's and a capital's", () => {
    const small = markerDimensions("small").fontSize;
    const medium = markerDimensions("medium").fontSize;
    const large = markerDimensions("large").fontSize;
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });
});

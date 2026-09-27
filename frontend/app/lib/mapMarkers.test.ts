import { describe, expect, it } from "vitest";

import {
  MARKER_HOVER_SCALE,
  MARKER_LABEL_MIN_SCREEN_PX,
  markerHitBounds,
  filterVisibleMapMarkers,
  markerIconScale,
  markerLayout,
  markerLabelTextStyle,
  pickMapMarkerAt,
  resolveMarkerImageSrc,
  type MapMarker,
} from "./mapMarkers";

describe("mapMarkers", () => {
  const sampleMarker = (
    overrides: Partial<MapMarker> = {}
  ): MapMarker => ({
    id: "a",
    kind: "settlement",
    markerSize: "small",
    mapX: 100,
    mapY: 200,
    label: "Town",
    title: "Town",
    ...overrides,
  });

  it("resolveMarkerImageSrc picks capital and normal assets", () => {
    expect(resolveMarkerImageSrc("faction_capital", "small")).toBe(
      "/capital_settlement_small.png"
    );
    expect(resolveMarkerImageSrc("settlement", "large")).toBe(
      "/settlement_large.png"
    );
  });

  it("resolveMarkerImageSrc picks installation assets", () => {
    expect(resolveMarkerImageSrc("fort", "small")).toBe("/fort.png");
    expect(resolveMarkerImageSrc("port", undefined)).toBe("/port.png");
    expect(resolveMarkerImageSrc("airport", "large")).toBe("/airport.png");
  });

  it("resolveMarkerImageSrc picks battle asset", () => {
    expect(resolveMarkerImageSrc("battle", "small")).toBe("/battle.png");
  });

  it("draws a large settlement icon at 90px", () => {
    const layout = markerLayout(100, 200, "large", "settlement");
    expect(layout.iconSize).toBe(90);
    expect(layout.size).toBe(90);
  });

  it("markerLayout centers icon on map coords", () => {
    const layout = markerLayout(100, 200, "small");
    expect(layout.imageX).toBe(50);
    expect(layout.imageY).toBe(150);
    expect(layout.textY).toBe(252);
    expect(layout.iconSize).toBe(100);
  });

  it("markerLayout shrinks installation icons to 75%", () => {
    const layout = markerLayout(100, 200, "small", "fort");
    expect(layout.iconSize).toBe(75);
    expect(layout.size).toBe(100);
    expect(layout.textY).toBe(252);
  });

  it("markerLayout shrinks battle icons to 75%", () => {
    const layout = markerLayout(100, 200, "small", "battle");
    expect(layout.iconSize).toBe(75);
  });

  it("filterVisibleMapMarkers hides markers below min screen label size", () => {
    const marker = sampleMarker();
    const fontSize = 48;
    const below = MARKER_LABEL_MIN_SCREEN_PX / fontSize - 0.01;
    const above = MARKER_LABEL_MIN_SCREEN_PX / fontSize + 0.01;
    expect(filterVisibleMapMarkers([marker], below)).toHaveLength(0);
    expect(filterVisibleMapMarkers([marker], above)).toHaveLength(1);
  });

  it("filterVisibleMapMarkers uses icon size for installation pins", () => {
    const fort = sampleMarker({
      id: "installation:Greenfold",
      kind: "fort",
      showLabelOnlyOnHover: true,
    });
    const iconSize = 100 * markerIconScale("fort");
    const below = MARKER_LABEL_MIN_SCREEN_PX / iconSize - 0.01;
    const above = MARKER_LABEL_MIN_SCREEN_PX / iconSize + 0.01;
    expect(filterVisibleMapMarkers([fort], below)).toHaveLength(0);
    expect(filterVisibleMapMarkers([fort], above)).toHaveLength(1);
    expect(filterVisibleMapMarkers([fort], 0.12)).toHaveLength(1);
    expect(filterVisibleMapMarkers([sampleMarker()], 0.12)).toHaveLength(0);
  });

  it("markerIconScale is 0.75 for installations only", () => {
    expect(markerIconScale("fort")).toBe(0.75);
    expect(markerIconScale("settlement")).toBe(1);
  });

  it("markerLabelTextStyle renders a sans chip, not haloed serif text", () => {
    const style = markerLabelTextStyle({ fontSize: 48, highlighted: false });
    expect(style.fontFamily).toContain("--font-source-sans");
    expect(style.color).toBe("var(--tfmc-cream)");
    expect(style.textShadow).toBeUndefined();
    expect(style.backgroundColor).toContain("--tfmc-forest-deep");
    expect(style.padding).toBeTruthy();
  });

  it("markerLabelTextStyle swaps chip colours when highlighted", () => {
    const plain = markerLabelTextStyle({ fontSize: 48, highlighted: false });
    const hovered = markerLabelTextStyle({ fontSize: 48, highlighted: true });
    expect(hovered.backgroundColor).not.toBe(plain.backgroundColor);
    expect(hovered.border).toContain("var(--tfmc-accent)");
    expect(hovered.textShadow).toBeUndefined();
  });

  it("pickMapMarkerAt hits icon and label bounds", () => {
    const marker = sampleMarker();
    const layout = markerLayout(marker.mapX, marker.mapY, marker.markerSize);
    const bounds = markerHitBounds(layout, marker.label);

    expect(
      pickMapMarkerAt([marker], bounds.x + bounds.w / 2, bounds.y + bounds.h / 2)
    ).toBe(marker);
    expect(pickMapMarkerAt([marker], bounds.x - 5, bounds.y - 5)).toBeNull();
  });

  it("pickMapMarkerAt uses icon-only bounds for hover-label markers", () => {
    const marker = sampleMarker({
      kind: "fort",
      showLabelOnlyOnHover: true,
    });
    const layout = markerLayout(
      marker.mapX,
      marker.mapY,
      marker.markerSize,
      marker.kind
    );
    const iconBounds = markerHitBounds(layout, marker.label, false);

    expect(
      pickMapMarkerAt([marker], layout.imageX + layout.size / 2, layout.imageY + layout.size / 2)
    ).toBe(marker);
    expect(
      pickMapMarkerAt(
        [marker],
        iconBounds.x + iconBounds.w / 2,
        iconBounds.y + iconBounds.h + 40
      )
    ).toBeNull();
  });

  it("pickMapMarkerAt prefers later markers when overlapping", () => {
    const first = sampleMarker({ id: "first" });
    const second = sampleMarker({ id: "second" });
    expect(pickMapMarkerAt([first, second], 100, 200)).toBe(second);
  });

  it("uses 5% hover scale", () => {
    expect(MARKER_HOVER_SCALE).toBe(1.05);
  });
});

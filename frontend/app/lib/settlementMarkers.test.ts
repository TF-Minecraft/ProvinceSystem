import { describe, expect, it } from "vitest";

import {
  SETTLEMENT_LABEL_FONT_LARGE,
  SETTLEMENT_LABEL_MIN_SCREEN_PX,
  filterPlacedSettlements,
  isSettlementMapMode,
  markerDimensions,
  resolveMarkerImageSrc,
  shouldShowSettlementMarker,
  visibleSettlementKind,
} from "./settlementMarkers";

describe("settlementMarkers", () => {
  it("resolveMarkerImageSrc picks capital and normal assets", () => {
    expect(resolveMarkerImageSrc("faction_capital", "small")).toBe(
      "/capital_settlement_small.png"
    );
    expect(resolveMarkerImageSrc("faction_capital", "large")).toBe(
      "/capital_settlement_large.png"
    );
    expect(resolveMarkerImageSrc("settlement", "small")).toBe(
      "/settlement_small.png"
    );
    expect(resolveMarkerImageSrc("settlement", "large")).toBe(
      "/settlement_large.png"
    );
    expect(resolveMarkerImageSrc(undefined, undefined)).toBe(
      "/settlement_small.png"
    );
  });

  it("markerDimensions returns tier sizes", () => {
    expect(markerDimensions("large").fontSize).toBe(SETTLEMENT_LABEL_FONT_LARGE);
    expect(markerDimensions("large").size).toBe(90);
    expect(markerDimensions("small").size).toBe(100);
  });

  it("shouldShowSettlementMarker gates on screen font size", () => {
    const fontSize = 10;
    const below = SETTLEMENT_LABEL_MIN_SCREEN_PX / fontSize - 0.01;
    const above = SETTLEMENT_LABEL_MIN_SCREEN_PX / fontSize + 0.01;
    expect(shouldShowSettlementMarker(fontSize, below)).toBe(false);
    expect(shouldShowSettlementMarker(fontSize, above)).toBe(true);
  });

  it("isSettlementMapMode is only true for nation", () => {
    expect(isSettlementMapMode("nation")).toBe(true);
    expect(isSettlementMapMode("county")).toBe(false);
    expect(isSettlementMapMode("duchy")).toBe(false);
    expect(isSettlementMapMode("kingdom")).toBe(false);
    expect(isSettlementMapMode("empire")).toBe(false);
    expect(isSettlementMapMode("trade")).toBe(false);
    expect(isSettlementMapMode("terrain")).toBe(false);
    expect(isSettlementMapMode("fertility")).toBe(false);
    expect(isSettlementMapMode("infestation")).toBe(false);
  });

  it("visibleSettlementKind hides capital star for hidden vassals", () => {
    const overview = [
      { id: "gaba_gaba", visible: true },
      { id: "invaders", visible: false },
    ];
    expect(
      visibleSettlementKind("faction_capital", "invaders", overview)
    ).toBe("settlement");
    expect(
      visibleSettlementKind("faction_capital", "gaba_gaba", overview)
    ).toBe("faction_capital");
    expect(
      visibleSettlementKind("faction_capital", "invaders", [
        { id: "invaders", visible: true },
      ])
    ).toBe("faction_capital");
  });

  it("filterPlacedSettlements keeps only finite map coords", () => {
    const out = filterPlacedSettlements([
      { id: "a", name: "A", map_x: 1, map_y: 2 },
      { id: "b", name: "B", map_x: undefined, map_y: 2 },
      { id: "c", name: "C" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });
});

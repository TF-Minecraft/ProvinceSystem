import { describe, expect, it } from "vitest";

import {
  filterPlacedSettlements,
  visibleSettlementKind,
} from "./settlementMarkers";

describe("settlementMarkers", () => {
  it("visibleSettlementKind hides capital star for hidden vassals", () => {
    const overview = [
      { id: "gaba_gaba", visible: true, nested: false, baseId: "gaba_gaba" },
      { id: "invaders", visible: false, nested: false, baseId: "invaders" },
    ];
    expect(
      visibleSettlementKind("faction_capital", "invaders", overview)
    ).toBe("settlement");
    expect(
      visibleSettlementKind("faction_capital", "gaba_gaba", overview)
    ).toBe("faction_capital");
    expect(
      visibleSettlementKind("faction_capital", "invaders", [
        { id: "invaders", visible: true, nested: false, baseId: "invaders" },
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

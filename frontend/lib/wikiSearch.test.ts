import { describe, expect, it } from "vitest";

import { normalizeSearchText, searchWikiIndex, type WikiSearchEntry } from "./wikiSearch";

const index: WikiSearchEntry[] = [
  {
    href: "/wiki/crafting#recipe",
    pageTitle: "Advanced Crafting",
    sectionTitle: "Forge recipe",
    text: "Combine coke, steel and iron in the forge.",
  },
  {
    href: "/wiki/items#steel",
    pageTitle: "Materials",
    sectionTitle: "Steel Ingot",
    text: "Used for tools and vehicles.",
  },
  { href: "/wiki/commands#pets", pageTitle: "Pets", sectionTitle: "Commands", text: "/pets opens your pet menu." },
];

describe("wiki search ranking", () => {
  it("ranks exact item and section names ahead of body mentions", () => {
    expect(searchWikiIndex(index, "steel ingot").map((entry) => entry.href)).toEqual(["/wiki/items#steel"]);
    expect(searchWikiIndex(index, "steel")[0].href).toBe("/wiki/items#steel");
  });

  it("finds recipes and commands from article content", () => {
    expect(searchWikiIndex(index, "coke iron")[0].href).toBe("/wiki/crafting#recipe");
    expect(searchWikiIndex(index, "/PETS")[0].href).toBe("/wiki/commands#pets");
  });

  it("normalizes case and accents and returns nothing for blank or missing terms", () => {
    expect(normalizeSearchText("  Véhicles  ")).toBe("vehicles");
    expect(searchWikiIndex(index, "   ")).toEqual([]);
    expect(searchWikiIndex(index, "dragonfruit")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import {
  allCommandRows,
  allCommands,
  allRecipes,
  duplicateCommands,
  findDuplicateCommands,
  getCommandsForHref,
  getNavItemByHref,
  getRecipesForStation,
  navItems,
  overviewNavItem,
  populatedCategories,
  wikiCategories,
  wikiSections,
} from "./index";
import type { WikiCommandSet } from "./types";

describe("wiki nav registry", () => {
  it("exposes the ten agreed category keys in order", () => {
    expect(wikiCategories.map((c) => c.key)).toEqual([
      "getting-started",
      "character",
      "professions",
      "gathering",
      "food",
      "magic",
      "combat",
      "vehicles",
      "social",
      "reference",
    ]);
  });

  it("derives nav items from the section registry, one per section", () => {
    expect(navItems).toEqual(wikiSections.map((s) => s.nav));
  });

  it("gives every page a unique href, a blurb and a real category", () => {
    const keys = new Set(wikiCategories.map((c) => c.key));
    const hrefs = navItems.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of navItems) {
      expect(item.href.startsWith("/wiki/"), item.href).toBe(true);
      expect(item.blurb.length, item.href).toBeGreaterThan(0);
      expect(keys.has(item.category), item.href).toBe(true);
    }
  });

  it("only surfaces categories that have pages", () => {
    for (const category of populatedCategories()) {
      expect(navItems.some((i) => i.category === category.key)).toBe(true);
    }
  });

  it("keeps the overview outside the page list", () => {
    expect(navItems.some((i) => i.href === overviewNavItem.href)).toBe(false);
    expect(getNavItemByHref("/wiki")).toBe(overviewNavItem);
  });
});

describe("recipe index derivation", () => {
  it("includes every registered section's recipes with no manual list", () => {
    for (const section of wikiSections) {
      for (const recipe of section.recipes ?? []) {
        expect(allRecipes, `${section.nav.href} / ${recipe.key}`).toContain(recipe);
      }
    }
  });

  it("resolves station recipes out of the derived index", () => {
    const withRecipes = allRecipes[0];
    expect(getRecipesForStation(withRecipes.station)).toContain(withRecipes);
    expect(getRecipesForStation("No Such Station")).toEqual([]);
  });
});

describe("command index derivation", () => {
  it("includes every registered section's command set with no manual list", () => {
    for (const section of wikiSections) {
      if (!section.commands) continue;
      expect(allCommands, section.nav.href).toContain(section.commands);
      expect(section.commands.href, "command set href must match its nav href").toBe(
        section.nav.href
      );
    }
  });

  it("skips sections that register no commands rather than breaking", () => {
    const withoutCommands = wikiSections.filter((s) => !s.commands);
    expect(withoutCommands.length).toBeGreaterThan(0);
    expect(allCommands.length).toBe(wikiSections.filter((s) => s.commands).length);
    for (const section of withoutCommands) {
      expect(getCommandsForHref(section.nav.href)).toBeUndefined();
      expect(allCommandRows.some((e) => e.href === section.nav.href)).toBe(false);
    }
  });

  it("tolerates a registered set with no commands in it", () => {
    const empty = allCommands.filter((set) => set.commands.length === 0);
    expect(empty.length).toBeGreaterThan(0);
    for (const set of empty) {
      expect(getCommandsForHref(set.href)).toBe(set);
      expect(allCommandRows.some((e) => e.href === set.href)).toBe(false);
    }
  });

  it("flattens every row, tagged with its system, sorted by command", () => {
    const expected = allCommands.flatMap((set) => set.commands.map((row) => row.command)).sort();
    expect(allCommandRows.map((e) => e.row.command)).toEqual(expected);
    for (const entry of allCommandRows) {
      expect(getCommandsForHref(entry.href)?.commands).toContain(entry.row);
      expect(entry.system).toBe(getCommandsForHref(entry.href)?.system);
    }
  });

  it("looks a section's commands up by href", () => {
    const first = allCommands[0];
    expect(getCommandsForHref(first.href)).toBe(first);
    expect(getCommandsForHref("/wiki/not-a-page")).toBeUndefined();
  });
});

describe("duplicate command detection", () => {
  const partyA: WikiCommandSet = {
    system: "Parties",
    href: "/wiki/parties",
    commands: [{ command: "/party", description: "Opens the party menu." }],
  };
  const partyB: WikiCommandSet = {
    system: "Dungeons",
    href: "/wiki/dungeons",
    commands: [
      { command: " /Party ", description: "Also claims /party." },
      { command: "/dungeon", description: "Opens the dungeon finder." },
    ],
  };

  it("finds a command claimed by two different sections", () => {
    const dupes = findDuplicateCommands([partyA, partyB]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].command).toBe("/party");
    expect(dupes[0].registrations.map((r) => r.href)).toEqual(["/wiki/parties", "/wiki/dungeons"]);
    expect(dupes[0].registrations.map((r) => r.system)).toEqual(["Parties", "Dungeons"]);
  });

  it("does not report a command listed twice by the same section", () => {
    const twice: WikiCommandSet = {
      system: "Parties",
      href: "/wiki/parties",
      commands: [
        { command: "/party", description: "Opens the party menu." },
        { command: "/party", description: "Duplicated by mistake." },
      ],
    };
    expect(findDuplicateCommands([twice])).toEqual([]);
  });

  it("reports nothing for a registry with no collisions, and never throws", () => {
    expect(findDuplicateCommands([partyA])).toEqual([]);
    expect(findDuplicateCommands([])).toEqual([]);
    expect(Array.isArray(duplicateCommands)).toBe(true);
  });
});

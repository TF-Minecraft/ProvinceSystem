import { describe, expect, it } from "vitest";

import { arrangeNote, groupBullets, weekLabel } from "./notes";

describe("weekLabel", () => {
  it("names the Monday of the ISO week", () => {
    expect(weekLabel("2026-W01")).toBe("Week of 29 December 2025");
    expect(weekLabel("2026-W02")).toBe("Week of 5 January 2026");
  });

  it("leaves an unrecognised key unchanged", () => {
    expect(weekLabel("this-week")).toBe("this-week");
  });
});

describe("groupBullets", () => {
  it("keeps known sections and drops anything else", () => {
    const groups = groupBullets([
      { id: "1", section: "fixed", body: "Fixed a door" },
      { id: "2", section: "new", body: "Added a station" },
      { id: "3", section: "secret", body: "hidden" },
      { id: "4", section: "technical", body: "Rebuilt a plugin" },
    ]);
    expect(groups.new.map((bullet) => bullet.id)).toEqual(["2"]);
    expect(groups.fixed.map((bullet) => bullet.id)).toEqual(["1"]);
    expect(groups.adjusted).toEqual([]);
    expect(groups.technical.map((bullet) => bullet.id)).toEqual(["4"]);
  });
});

describe("arrangeNote", () => {
  it("puts a summary first, groups the changes, and leaves fixes and technical apart", () => {
    const note = arrangeNote([
      { id: "mage", section: "adjusted", body: "Mage gear now scales by ingot tier." },
      { id: "station", section: "new", body: "Added a weapon station." },
      { id: "door", section: "fixed", body: "Fixed a door" },
      { id: "plugin", section: "technical", body: "Rebuilt a plugin" },
      { id: "price", section: "adjusted", body: "Lowered a price" },
    ]);
    expect(note.highlights.map((bullet) => bullet.id)).toEqual(["mage", "station", "price"]);
    expect(note.topics.map((topic) => topic.label)).toEqual(["Classes", "Crafting", "Other"]);
    expect(note.topics[0].bullets.map((bullet) => bullet.id)).toEqual(["mage"]);
    expect(note.fixes.map((bullet) => bullet.id)).toEqual(["door"]);
    expect(note.technical.map((bullet) => bullet.id)).toEqual(["plugin"]);
  });

  it("uses a marked highlight instead of the first changes", () => {
    const note = arrangeNote([
      { id: "mage", section: "adjusted", body: "Mage gear now scales by ingot tier.", highlight: true },
      { id: "food", section: "adjusted", body: "Food recipes changed." },
    ]);
    expect(note.highlights.map((bullet) => bullet.id)).toEqual(["mage"]);
    expect(note.topics.map((topic) => topic.id)).toEqual(["classes", "crafting"]);
  });

  it("keeps an explicit topic ahead of the guess", () => {
    const note = arrangeNote([
      { id: "knife", section: "new", body: "Added a hunting knife.", topic: "classes" },
    ]);
    expect(note.topics.map((topic) => topic.id)).toEqual(["classes"]);
  });
});

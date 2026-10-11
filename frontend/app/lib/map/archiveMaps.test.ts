import { describe, expect, it } from "vitest";

import type { AccessibleMapEntry } from "@/lib/map/api";

import { archivedChapterMaps, isArchivedMap, showReviewHistory } from "./archiveMaps";

function entry(overrides: Partial<AccessibleMapEntry> & Pick<AccessibleMapEntry, "id">): AccessibleMapEntry {
  return {
    display_name: overrides.id,
    public: true,
    archived: false,
    ...overrides,
  };
}

describe("archivedChapterMaps", () => {
  it("keeps archived chapters and drops the live socket ids", () => {
    const maps = [
      entry({ id: "main", display_name: "Adavaar", archived: false }),
      entry({ id: "dev", display_name: "Sandbox", archived: true }),
      entry({ id: "calavorn", display_name: "Calavorn", archived: true }),
    ];
    expect(archivedChapterMaps(maps).map((item) => item.id)).toEqual(["calavorn"]);
  });

  it("sorts by display name then id", () => {
    const maps = [
      entry({ id: "zeta", display_name: "Zeta", archived: true }),
      entry({ id: "beta", display_name: "Alpha", archived: true }),
      entry({ id: "alpha", display_name: "Alpha", archived: true }),
    ];
    expect(archivedChapterMaps(maps).map((item) => item.id)).toEqual(["alpha", "beta", "zeta"]);
  });
});

describe("isArchivedMap", () => {
  const maps = [entry({ id: "main", archived: false }), entry({ id: "calavorn", archived: true })];

  it("is true only for a listed archived id", () => {
    expect(isArchivedMap("calavorn", maps)).toBe(true);
    expect(isArchivedMap("main", maps)).toBe(false);
    expect(isArchivedMap("unknown", maps)).toBe(false);
    expect(isArchivedMap("calavorn", [])).toBe(false);
  });
});

describe("showReviewHistory", () => {
  it("is always on for a live map, with no index fetch implied", () => {
    const maps = [entry({ id: "main", archived: false })];
    expect(showReviewHistory("main", maps)).toBe(true);
    expect(showReviewHistory("main", [])).toBe(true);
  });

  it("hides Calavorn until the chapter has days", () => {
    const maps = [entry({ id: "calavorn", archived: true, has_chronicle_days: false })];
    expect(showReviewHistory("calavorn", maps)).toBe(false);
  });

  it("shows Review History on an archived chapter with days", () => {
    const maps = [entry({ id: "ch01", archived: true, has_chronicle_days: true })];
    expect(showReviewHistory("ch01", maps)).toBe(true);
  });
});

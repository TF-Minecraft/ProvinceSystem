import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";

import { buildEditorTitlesZip, EDITOR_TIER_FILES, editorTitlesZipFilename } from "./buildEditorTitlesZip";

describe("buildEditorTitlesZip", () => {
  it("builds a zip with four tier json files", () => {
    const zipBytes = buildEditorTitlesZip({
      county: {
        COUNTY_1: {
          name: "North",
          rgb: "58,132,60",
          provinces: [1, 2],
        },
      },
      duchy: {},
      kingdom: {},
      empire: {},
    });

    const entries = unzipSync(zipBytes);
    expect(Object.keys(entries).sort()).toEqual(Object.values(EDITOR_TIER_FILES).sort());
  });

  it("serializes county json with provinces array", () => {
    const zipBytes = buildEditorTitlesZip({
      county: {
        COUNTY_1: {
          name: "North",
          rgb: "58,132,60",
          provinces: [1, 2],
        },
      },
      duchy: {},
      kingdom: {},
      empire: {},
    });

    const entries = unzipSync(zipBytes);
    const countyJson = new TextDecoder().decode(entries["county.json"]);
    const parsed = JSON.parse(countyJson) as Record<string, unknown>;
    expect(parsed.COUNTY_1).toEqual({
      name: "North",
      rgb: "58,132,60",
      provinces: [1, 2],
    });
  });

  it("formats filename with map id and date", () => {
    const date = new Date("2026-08-23T12:00:00Z");
    expect(editorTitlesZipFilename("main", date)).toBe("main-titles-2026-08-23.zip");
  });
});

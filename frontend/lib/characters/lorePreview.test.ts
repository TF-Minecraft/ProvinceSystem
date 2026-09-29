import { describe, expect, it } from "vitest";
import { parseNameRuns } from "./lorePreview";

describe("parseNameRuns", () => {
  it("parses §x hex colours", () => {
    expect(parseNameRuns("§x§a§3§a§1§8§4The Guild")).toEqual([
      { text: "The Guild", color: "#a3a184", bold: false, italic: false, underline: false, strike: false },
    ]);
  });

  it("parses gradient names with doubled section signs", () => {
    const runs = parseNameRuns("§x§a§3§a§1§8§4§§x§3§9§6§E§4§7T§§x§3§9§7§0§5§5h");
    expect(runs.map((r) => r.text).join("")).toBe("Th");
    expect(runs.map((r) => r.color)).toEqual(["#396e47", "#397055"]);
  });
});

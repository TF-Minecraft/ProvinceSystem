import { describe, expect, it } from "vitest";

import { applySuggestion, committedNames, currentToken, suggestPlayers } from "@/lib/precedent/playerSuggest";

const KNOWN = ["alterind", "drterror23", "Gvinno", "hydra_dr", "noobz___"];

describe("currentToken", () => {
  it("returns the text after the last comma", () => {
    expect(currentToken("Gvinno, drt")).toBe("drt");
    expect(currentToken("alt")).toBe("alt");
  });

  it("is empty right after a comma", () => {
    expect(currentToken("Gvinno, ")).toBe("");
  });
});

describe("committedNames", () => {
  it("excludes the token still being typed", () => {
    expect(committedNames("Gvinno, alterind, drt")).toEqual(["Gvinno", "alterind"]);
  });

  it("is empty when nothing is committed yet", () => {
    expect(committedNames("Gvi")).toEqual([]);
  });
});

describe("suggestPlayers", () => {
  it("suggests nothing for an empty token", () => {
    expect(suggestPlayers("", KNOWN)).toEqual([]);
    expect(suggestPlayers("Gvinno, ", KNOWN)).toEqual([]);
  });

  it("ranks prefix matches above mid-string matches", () => {
    expect(suggestPlayers("dr", KNOWN)).toEqual(["drterror23", "hydra_dr"]);
  });

  it("is case-insensitive", () => {
    expect(suggestPlayers("GVI", KNOWN)).toEqual(["Gvinno"]);
  });

  it("does not re-suggest an already committed name", () => {
    expect(suggestPlayers("drterror23, dr", KNOWN)).toEqual(["hydra_dr"]);
  });

  it("does not suggest an exact match of what is typed", () => {
    expect(suggestPlayers("Gvinno", KNOWN)).toEqual([]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => `player${i}`);
    expect(suggestPlayers("player", many, 5)).toHaveLength(5);
  });
});

describe("applySuggestion", () => {
  it("completes the first name and leaves a separator ready", () => {
    expect(applySuggestion("Gvi", "Gvinno")).toBe("Gvinno, ");
  });

  it("replaces only the token being typed", () => {
    expect(applySuggestion("Gvinno, drt", "drterror23")).toBe("Gvinno, drterror23, ");
  });

  it("works when the token is empty", () => {
    expect(applySuggestion("Gvinno, ", "alterind")).toBe("Gvinno, alterind, ");
  });
});

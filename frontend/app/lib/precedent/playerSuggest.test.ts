import { describe, expect, it } from "vitest";

import type { PrecedentCase } from "@/lib/precedent/api";
import {
  applySuggestion,
  collectKnownPlayers,
  committedNames,
  currentToken,
  suggestPlayers,
} from "@/lib/precedent/playerSuggest";

function caseWith(players: string[]): PrecedentCase {
  return {
    id: "x",
    logged_by: "s",
    players,
    summary: "s",
    rule: "",
    ruling: "",
    punishment: "",
    created_at: null,
  };
}

const KNOWN = ["alterind", "drterror23", "Gvinno", "hydra_dr", "noobz___"];

describe("collectKnownPlayers", () => {
  it("dedupes case-insensitively and sorts", () => {
    const out = collectKnownPlayers([caseWith(["Gvinno", "alterind"]), caseWith(["gvinno", " alterind "])]);
    expect(out).toEqual(["alterind", "Gvinno"]);
  });

  it("keeps the first spelling seen, so casing does not flicker", () => {
    const out = collectKnownPlayers([caseWith(["Gvinno"]), caseWith(["GVINNO"])]);
    expect(out).toEqual(["Gvinno"]);
  });

  it("ignores blanks and missing arrays", () => {
    const bare = { ...caseWith([]), players: undefined as unknown as string[] };
    expect(collectKnownPlayers([caseWith(["", "  "]), bare])).toEqual([]);
  });
});

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

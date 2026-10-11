import { describe, expect, it } from "vitest";

import type { PrecedentCase } from "@/lib/precedent/api";
import {
  caseMatchesFilter,
  cleanSynthesis,
  filterCases,
  formatCreatedAt,
  parsePlayers,
  punishmentTone,
  rulingTone,
  visibleRuling,
} from "@/lib/precedent/filter";

function makeCase(overrides: Partial<PrecedentCase> = {}): PrecedentCase {
  return {
    id: "case-1",
    logged_by: "WrenPlays",
    players: ["alterind"],
    summary: "Illegal usage of Xaero's Minimap (4.8)",
    rule: "4.8",
    ruling: "Upheld",
    punishment: "10y",
    created_at: "2026-08-26T11:29:35.433129+00:00",
    ...overrides,
  };
}

describe("caseMatchesFilter", () => {
  it("matches on summary, case-insensitively", () => {
    expect(caseMatchesFilter(makeCase(), "xaero")).toBe(true);
    expect(caseMatchesFilter(makeCase(), "XAERO")).toBe(true);
  });

  it("matches on rule, ruling, punishment, logged_by and players", () => {
    const row = makeCase();
    expect(caseMatchesFilter(row, "4.8")).toBe(true);
    expect(caseMatchesFilter(row, "upheld")).toBe(true);
    expect(caseMatchesFilter(row, "10y")).toBe(true);
    expect(caseMatchesFilter(row, "wrenplays")).toBe(true);
    expect(caseMatchesFilter(row, "alterind")).toBe(true);
  });

  it("does not match unrelated text", () => {
    expect(caseMatchesFilter(makeCase(), "banana bread")).toBe(false);
  });

  it("treats an empty or whitespace filter as match-all", () => {
    expect(caseMatchesFilter(makeCase(), "")).toBe(true);
    expect(caseMatchesFilter(makeCase(), "   ")).toBe(true);
  });

  it("tolerates a missing players array", () => {
    const row = { ...makeCase(), players: undefined as unknown as string[] };
    expect(caseMatchesFilter(row, "xaero")).toBe(true);
  });
});

describe("filterCases", () => {
  it("returns the original array when the filter is blank", () => {
    const rows = [makeCase(), makeCase({ id: "case-2" })];
    expect(filterCases(rows, "  ")).toBe(rows);
  });

  it("narrows to matching rows only", () => {
    const rows = [
      makeCase({ id: "a", summary: "Xray" }),
      makeCase({ id: "b", summary: "Stealing without clues", rule: "7.2" }),
    ];
    expect(filterCases(rows, "xray").map((r) => r.id)).toEqual(["a"]);
  });
});

describe("cleanSynthesis", () => {
  it("strips bold markers Claude emits, which Discord renders but the web does not", () => {
    expect(cleanSynthesis("**Precedent Analysis:** rule 4.8 applies")).toBe("Precedent Analysis: rule 4.8 applies");
  });

  it("strips italic, bold-italic and underscore emphasis", () => {
    expect(cleanSynthesis("*careful* here")).toBe("careful here");
    expect(cleanSynthesis("***very*** clear")).toBe("very clear");
    expect(cleanSynthesis("__strong__ case")).toBe("strong case");
  });

  it("strips heading markers", () => {
    expect(cleanSynthesis("## Summary\nBody text")).toBe("Summary\nBody text");
  });

  it("leaves ordinary prose and inner punctuation alone", () => {
    const plain = "Rule 4.8 applies. Ban length follows the escalating scale.";
    expect(cleanSynthesis(plain)).toBe(plain);
  });

  it("does not mangle a lone asterisk or multiplication", () => {
    expect(cleanSynthesis("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("spans emphasis across newlines", () => {
    expect(cleanSynthesis("**line one\nline two**")).toBe("line one\nline two");
  });
});

describe("parsePlayers", () => {
  it("splits on commas and drops blanks", () => {
    expect(parsePlayers(" Alice , ,Bob ")).toEqual(["Alice", "Bob"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(parsePlayers("")).toEqual([]);
  });
});

describe("rulingTone", () => {
  it("marks upheld outcomes positive", () => {
    expect(rulingTone("Upheld")).toBe("positive");
    expect(rulingTone("upheld")).toBe("positive");
    expect(rulingTone("Guilty")).toBe("positive");
  });

  it("marks reversed outcomes negative", () => {
    expect(rulingTone("Overturned")).toBe("negative");
    expect(rulingTone("Pardoned")).toBe("negative");
    expect(rulingTone("Denied")).toBe("negative");
    expect(rulingTone("Dismissed")).toBe("negative");
  });

  it("falls back to neutral for empty or unrecognised rulings", () => {
    expect(rulingTone("")).toBe("neutral");
    expect(rulingTone("Pending review")).toBe("neutral");
    expect(rulingTone("Decided by helper-tier staff")).toBe("neutral");
  });

  it("only treats a bare affirmative as the default outcome", () => {
    // Real corpus value: contains "Confirmed" but is evidence detail, so it
    // must not be classified as the unremarkable default and hidden.
    expect(rulingTone("Confirmed via replay mod footage, admitted after questioning")).toBe("neutral");
  });
});

describe("visibleRuling", () => {
  it("hides upheld rulings, which are the unremarkable default", () => {
    expect(visibleRuling("Upheld")).toBeNull();
    expect(visibleRuling("upheld")).toBeNull();
    expect(visibleRuling("Guilty")).toBeNull();
  });

  it("shows pardons and overturns, which are the exceptions worth seeing", () => {
    expect(visibleRuling("Pardoned")).toBe("Pardoned");
    expect(visibleRuling("Overturned")).toBe("Overturned");
  });

  it("shows unrecognised rulings rather than silently dropping them", () => {
    expect(visibleRuling("Reduced on appeal")).toBe("Reduced on appeal");
    expect(visibleRuling("Decided by helper-tier staff")).toBe("Decided by helper-tier staff");
    expect(visibleRuling("Confirmed via replay mod footage, admitted after questioning")).not.toBeNull();
  });

  it("returns null for an empty ruling", () => {
    expect(visibleRuling("")).toBeNull();
    expect(visibleRuling("   ")).toBeNull();
  });
});

describe("punishmentTone", () => {
  it("marks permanent removals as most severe", () => {
    expect(punishmentTone("Permanent, no appeal")).toBe("negative");
    expect(punishmentTone("Perma with appeal")).toBe("negative");
    expect(punishmentTone("blacklist")).toBe("negative");
  });

  it("treats multi-year bans as severe", () => {
    expect(punishmentTone("10y")).toBe("negative");
    expect(punishmentTone("2 y")).toBe("negative");
  });

  it("treats short durations and warnings as intermediate", () => {
    expect(punishmentTone("24h")).toBe("warning");
    expect(punishmentTone("30d")).toBe("warning");
    expect(punishmentTone("Warning")).toBe("warning");
    expect(punishmentTone("mute")).toBe("warning");
  });

  it("treats no punishment as neutral", () => {
    expect(punishmentTone("")).toBe("neutral");
    expect(punishmentTone("none")).toBe("neutral");
    expect(punishmentTone("N/A")).toBe("neutral");
  });
});

describe("formatCreatedAt", () => {
  it("renders an ISO timestamp as a date", () => {
    expect(formatCreatedAt("2026-08-26T11:29:35.433129+00:00")).toBe("2026-08-26");
  });

  it("handles null and unparseable input", () => {
    expect(formatCreatedAt(null)).toBe("unknown date");
    expect(formatCreatedAt("not a date")).toBe("unknown date");
  });
});

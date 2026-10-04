import { describe, expect, it } from "vitest";

import { formatChronicleDay } from "./chronicleDayLabel";

describe("formatChronicleDay", () => {
  it("writes a stored day the British way", () => {
    expect(formatChronicleDay("2026-08-15")).toBe("15 Aug 2026");
    expect(formatChronicleDay("2026-01-01")).toBe("1 Jan 2026");
  });

  it("leaves anything that is not a day alone", () => {
    expect(formatChronicleDay("")).toBe("");
    expect(formatChronicleDay("yesterday")).toBe("yesterday");
  });
});

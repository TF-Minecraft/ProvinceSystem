import { describe, expect, it } from "vitest";
import { pairBudgetHint } from "./sizes";

describe("pairBudgetHint", () => {
  it("is empty without a budget", () => {
    expect(pairBudgetHint(undefined)).toBe("");
    expect(pairBudgetHint(0)).toBe("");
  });

  it("shows whole kilobytes, rounded down", () => {
    expect(pairBudgetHint(262_144)).toBe("Model + texture: max 256 KB");
    expect(pairBudgetHint(20_000)).toBe("Model + texture: max 19 KB");
  });

  it("keeps one decimal under 10 KB and bytes under 1 KB", () => {
    expect(pairBudgetHint(5_000)).toBe("Model + texture: max 4.8 KB");
    expect(pairBudgetHint(800)).toBe("Model + texture: max 800 bytes");
  });
});

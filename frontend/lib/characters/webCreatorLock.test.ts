import { expect, it } from "vitest";
import { webCreatorLockLabel } from "./webCreatorLock";

it("is empty while the creator is open", () => {
  expect(webCreatorLockLabel(true, "noble")).toBe("");
  expect(webCreatorLockLabel(undefined, "")).toBe("");
});

it("names the rank the creator needs", () => {
  expect(webCreatorLockLabel(false, "high_noble")).toBe(
    "Needs High Noble rank or higher. Just ranked up? Join the server once, then refresh.",
  );
  expect(webCreatorLockLabel(false, " ")).toMatch(/^Needs donator rank/);
});

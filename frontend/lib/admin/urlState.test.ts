/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { resetUrlWrites, writeUrl } from "./urlState";

beforeEach(() => {
  vi.useFakeTimers();
  resetUrlWrites();
});

afterEach(() => {
  vi.useRealTimers();
});

it("stays under Safari's history limit and writes the latest once allowed", () => {
  const replace = vi.spyOn(window.history, "replaceState");
  for (let i = 0; i < 200; i += 1) writeUrl(`/x?at=${i}`, true);
  expect(replace).toHaveBeenCalledTimes(30);
  vi.advanceTimersByTime(10_000);
  expect(replace).toHaveBeenCalledTimes(31);
  expect(window.location.search).toBe("?at=199");
});

it("never lets a history error escape", () => {
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {
    throw new DOMException("Attempt to use history.replaceState() more than 100 times per 10 seconds", "SecurityError");
  });
  expect(() => writeUrl("/x?at=1", true)).not.toThrow();
});

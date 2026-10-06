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

it("drops a held write once the reader has left its page", () => {
  window.history.replaceState(null, "", "/admin/movement");
  const replace = vi.spyOn(window.history, "replaceState");
  for (let i = 0; i < 40; i += 1) writeUrl(`/admin/movement?at=${i}`, true);
  window.history.pushState(null, "", "/map");
  replace.mockClear();
  vi.advanceTimersByTime(10_000);
  expect(replace).not.toHaveBeenCalled();
  expect(window.location.pathname).toBe("/map");
});

it("drops a held write after back or forward on the same page", () => {
  window.history.replaceState(null, "", "/admin/movement?at=1");
  const replace = vi.spyOn(window.history, "replaceState");
  for (let i = 0; i < 40; i += 1) writeUrl(`/admin/movement?at=${i}`, true);
  window.history.pushState(null, "", "/admin/movement?session=other");
  replace.mockClear();
  vi.advanceTimersByTime(10_000);
  expect(replace).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?session=other");
});

it("never lets a history error escape", () => {
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {
    throw new DOMException("Attempt to use history.replaceState() more than 100 times per 10 seconds", "SecurityError");
  });
  expect(() => writeUrl("/x?at=1", true)).not.toThrow();
});

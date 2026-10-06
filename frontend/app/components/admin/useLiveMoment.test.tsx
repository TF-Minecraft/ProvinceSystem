/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useLiveMoment } from "./MovementControls";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("moves at once and writes the moment once it rests", () => {
  const write = vi.fn();
  const { result } = renderHook(({ at, view }) => useLiveMoment(at, view, write), {
    initialProps: { at: null as number | null, view: "session:a" },
  });
  act(() => result.current.move(100));
  act(() => result.current.move(200));
  expect(result.current.at).toBe(200);
  expect(write).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(300));
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith(200);
});

it("drops a pending write when the view or the URL's moment changes", () => {
  const write = vi.fn();
  const { result, rerender } = renderHook(({ at, view }) => useLiveMoment(at, view, write), {
    initialProps: { at: 50 as number | null, view: "session:a" },
  });
  act(() => result.current.move(100));
  rerender({ at: 50, view: "session:b" });
  expect(result.current.at).toBe(50);
  act(() => vi.advanceTimersByTime(300));
  expect(write).not.toHaveBeenCalled();

  act(() => result.current.move(120));
  // Back or forward changed the URL's moment while this one was pending.
  rerender({ at: 70, view: "session:b" });
  expect(result.current.at).toBe(70);
  act(() => vi.advanceTimersByTime(300));
  expect(write).not.toHaveBeenCalled();
});

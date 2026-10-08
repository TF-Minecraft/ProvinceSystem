/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readViewportSize, useMapViewport } from "./useMapViewport";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readViewportSize", () => {
  it("returns width and height from getBoundingClientRect", () => {
    const element = {
      getBoundingClientRect: () => ({
        width: 1200,
        height: 800,
        left: 0,
        top: 0,
        right: 1200,
        bottom: 800,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as HTMLElement;

    expect(readViewportSize(element)).toEqual({ w: 1200, h: 800 });
  });
});

// Stable, as callers keep it: a new size each render re-clamps each render.
const MAP_SIZE = { w: 6400, h: 6400 };

function Viewport() {
  const viewport = useMapViewport({ mapSize: MAP_SIZE, restingZoom: true });
  return createElement(
    "div",
    { ref: viewport.viewportRef, "data-testid": "viewport" },
    createElement("div", {
      ref: viewport.contentRef,
      "data-testid": "content",
      "data-zoom": viewport.zoom,
      style: { transform: viewport.transformStyle },
    })
  );
}

/** The translate in a `translate(x, y) scale(s)` transform, in device pixels. */
function devicePixels(transform: string, ratio: number): number[] {
  const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(transform);
  return match ? [Number(match[1]) * ratio, Number(match[2]) * ratio] : [];
}

describe("useMapViewport", () => {
  it("keeps a wheel zoom on whole device pixels, where it settles", () => {
    vi.useFakeTimers();
    vi.stubGlobal("devicePixelRatio", 1.25);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 777,
      height: 555,
      left: 0,
      top: 0,
      right: 777,
      bottom: 555,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const { getByTestId } = render(createElement(Viewport));
    const content = getByTestId("content");

    fireEvent.wheel(getByTestId("viewport"), { deltaY: -100, clientX: 333.3, clientY: 201.7 });
    const live = content.style.transform;
    expect(live).not.toContain("scale(1)");
    for (const value of devicePixels(live, 1.25)) expect(value).toBeCloseTo(Math.round(value), 9);
    expect(content.style.getPropertyValue("--map-live-scale")).not.toBe("");

    // Settled, the scale moves into `zoom` and the map stays where it was.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const rest = content.style.transform;
    expect(rest).toContain("scale(1)");
    expect(devicePixels(rest, 1.25)).toEqual(devicePixels(live, 1.25));
    expect(content.style.getPropertyValue("--map-live-scale")).toBe("");
  });
});

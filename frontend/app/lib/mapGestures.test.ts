import { describe, expect, it } from "vitest";

import {
  DRAG_THRESHOLD_PX,
  KEYBOARD_PAN_PX,
  MAP_ZOOM_STEP,
  exceedsDragThreshold,
  isTypingTarget,
  keyboardMapAction,
  pinchSample,
  pinchUserScale,
} from "./mapGestures";

describe("exceedsDragThreshold", () => {
  it("treats a small wobble as a click", () => {
    expect(exceedsDragThreshold(2, 2)).toBe(false);
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX, 0)).toBe(false);
  });

  it("treats a longer move as a drag", () => {
    expect(exceedsDragThreshold(DRAG_THRESHOLD_PX + 1, 0)).toBe(true);
    expect(exceedsDragThreshold(-4, -4)).toBe(true);
  });
});

describe("pinch", () => {
  it("samples the distance and midpoint of two fingers", () => {
    expect(pinchSample({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({
      distance: 50,
      midpoint: { x: 15, y: 20 },
    });
  });

  it("scales by how far the fingers spread", () => {
    const start = pinchSample({ x: 0, y: 0 }, { x: 100, y: 0 });
    const spread = pinchSample({ x: 0, y: 0 }, { x: 250, y: 0 });

    expect(pinchUserScale(2, start, spread)).toBeCloseTo(5);
  });

  it("keeps the start scale for a degenerate pinch", () => {
    const start = pinchSample({ x: 10, y: 10 }, { x: 10, y: 10 });
    const later = pinchSample({ x: 0, y: 0 }, { x: 50, y: 0 });

    expect(pinchUserScale(3, start, later)).toBe(3);
  });
});

describe("isTypingTarget", () => {
  it("recognises text fields", () => {
    expect(isTypingTarget({ tagName: "INPUT" } as HTMLElement)).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" } as HTMLElement)).toBe(true);
    expect(
      isTypingTarget({ tagName: "DIV", isContentEditable: true } as HTMLElement)
    ).toBe(true);
  });

  it("leaves the map and buttons alone", () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({ tagName: "BUTTON" } as HTMLElement)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe("keyboardMapAction", () => {
  it("moves the map opposite to the arrow, like dragging the view", () => {
    expect(keyboardMapAction("ArrowLeft")).toEqual({
      kind: "pan",
      dx: KEYBOARD_PAN_PX,
      dy: 0,
    });
    expect(keyboardMapAction("ArrowDown")).toEqual({
      kind: "pan",
      dx: 0,
      dy: -KEYBOARD_PAN_PX,
    });
  });

  it("zooms with plus and minus", () => {
    expect(keyboardMapAction("+")).toEqual({ kind: "zoom", factor: MAP_ZOOM_STEP });
    expect(keyboardMapAction("=")).toEqual({ kind: "zoom", factor: MAP_ZOOM_STEP });
    expect(keyboardMapAction("-")).toEqual({
      kind: "zoom",
      factor: 1 / MAP_ZOOM_STEP,
    });
  });

  it("ignores other keys", () => {
    expect(keyboardMapAction("a")).toBeNull();
    expect(keyboardMapAction("Enter")).toBeNull();
  });
});

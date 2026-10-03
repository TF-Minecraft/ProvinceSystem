import type { ViewportPoint } from "./mapViewportMath";

/**
 * How far (screen px) a press may wander before it counts as a drag. Below
 * this a left press is still a click, so a slightly shaky hand selecting a
 * nation does not nudge the map instead.
 */
export const DRAG_THRESHOLD_PX = 4;

/** Zoom step for the +/- buttons, the keyboard and double-click. */
export const MAP_ZOOM_STEP = 1.6;

/** Pixels the arrow keys move the map per press. */
export const KEYBOARD_PAN_PX = 120;

export function exceedsDragThreshold(dx: number, dy: number): boolean {
  return dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

export type PinchSample = {
  distance: number;
  midpoint: ViewportPoint;
};

/** Distance and midpoint of two touch points, both in viewport pixels. */
export function pinchSample(a: ViewportPoint, b: ViewportPoint): PinchSample {
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/**
 * The user scale a pinch has reached: the scale at pinch start, times how far
 * the fingers have spread since. A degenerate start (fingers on the same
 * pixel) keeps the start scale rather than dividing by zero.
 */
export function pinchUserScale(
  startUserScale: number,
  start: PinchSample,
  current: PinchSample
): number {
  if (start.distance <= 0) return startUserScale;
  return startUserScale * (current.distance / start.distance);
}

/**
 * Whether a key press belongs to a text field rather than the map. Map
 * shortcuts must never steal arrows or +/- from the search box, the paint
 * text editor, or any other input on the page.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== "string") {
    return false;
  }
  const element = target as HTMLElement;
  const tag = element.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true
  );
}

export type KeyboardMapAction =
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "zoom"; factor: number }
  | null;

/** Arrow keys pan, +/- zoom; anything else is not the map's business. */
export function keyboardMapAction(key: string): KeyboardMapAction {
  switch (key) {
    case "ArrowLeft":
      return { kind: "pan", dx: KEYBOARD_PAN_PX, dy: 0 };
    case "ArrowRight":
      return { kind: "pan", dx: -KEYBOARD_PAN_PX, dy: 0 };
    case "ArrowUp":
      return { kind: "pan", dx: 0, dy: KEYBOARD_PAN_PX };
    case "ArrowDown":
      return { kind: "pan", dx: 0, dy: -KEYBOARD_PAN_PX };
    case "+":
    case "=":
      return { kind: "zoom", factor: MAP_ZOOM_STEP };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / MAP_ZOOM_STEP };
    default:
      return null;
  }
}

/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Timeline } from "./MovementControls";

const since = 1_791_634_620;
const until = since + 900;
const left = 100;
const width = 900;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => frames.push(run));
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.getBoundingClientRect = () => ({ left, width, top: 0, height: 40, right: left + width, bottom: 40, x: left, y: 0, toJSON: () => ({}) });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  frames = [];
});

function setup(bands = [{ from: since + 300, to: since + 600 }]) {
  const onCursor = vi.fn();
  render(<Timeline since={since} until={until} unknownUntil={null} unknownLabel="" bands={bands} cursor={since} onCursor={onCursor} />);
  return { onCursor, bar: screen.getByRole("slider", { name: "Inspected moment" }) };
}

/** jsdom has no PointerEvent: a mouse event carrying its fields stands in. */
function pointer(target: Element, type: string, x: number, pointerType: "mouse" | "touch") {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: left + x, button: 0 });
  Object.assign(event, { pointerId: pointerType === "mouse" ? 1 : 2, pointerType });
  fireEvent(target, event);
  // The next frame, where the move lands.
  for (const run of frames.splice(0)) run(0);
}

it("moves the moment where the mouse presses and drags", () => {
  const { bar, onCursor } = setup([]);
  pointer(bar, "pointerdown", 100, "mouse");
  expect(onCursor).toHaveBeenLastCalledWith(since + 100);
  pointer(bar, "pointermove", 450, "mouse");
  expect(onCursor).toHaveBeenLastCalledWith(since + 450);
  pointer(bar, "pointerup", 450, "mouse");
});

it("lets a finger scroll the page without moving the moment, and moves it on a tap", () => {
  const { bar, onCursor } = setup([]);
  pointer(bar, "pointerdown", 200, "touch");
  pointer(bar, "pointercancel", 200, "touch");
  expect(onCursor).not.toHaveBeenCalled();
  pointer(bar, "pointerdown", 700, "touch");
  pointer(bar, "pointerup", 700, "touch");
  expect(onCursor).toHaveBeenLastCalledWith(since + 700);
});

it("draws a drag near a band's edge onto the edge", () => {
  const { bar, onCursor } = setup();
  pointer(bar, "pointerdown", 304, "mouse");
  expect(onCursor).toHaveBeenLastCalledWith(since + 300);
  pointer(bar, "pointermove", 320, "mouse");
  expect(onCursor).toHaveBeenLastCalledWith(since + 320);
});

it("steps with the keyboard and stays inside the span", () => {
  const { bar, onCursor } = setup();
  fireEvent.keyDown(bar, { key: "ArrowRight" });
  expect(onCursor).toHaveBeenLastCalledWith(since + 60);
  fireEvent.keyDown(bar, { key: "ArrowLeft" });
  expect(onCursor).toHaveBeenLastCalledWith(since);
  fireEvent.keyDown(bar, { key: "End" });
  expect(onCursor).toHaveBeenLastCalledWith(until);
});

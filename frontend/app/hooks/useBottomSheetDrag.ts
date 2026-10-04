"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Dragged this far, a released sheet changes size or closes. */
const SNAP_DISTANCE_PX = 96;
/** Or flicked at least this fast (px per ms) at the end of the drag. */
const SNAP_VELOCITY = 0.5;
/** How far back the flick speed is measured: one touch sample is too noisy. */
const VELOCITY_WINDOW_MS = 100;
const SETTLE_MS = 180;
/** The least a sheet shrinks to while it is dragged down from full height. */
const MIN_DRAG_HEIGHT_PX = 120;

export type BottomSheetDragOptions = {
  /** Pulled down from its smaller size: close the sheet. */
  onClose: () => void;
  /**
   * A sheet with two sizes, like Google Maps' place sheet: whether it is at
   * full height now. Omit for a sheet with one size.
   */
  expanded?: boolean;
  /** Pushed up at its smaller size, or pulled down at full height. */
  onExpandedChange?: (expanded: boolean) => void;
  /** Its height at full size, in px, so a drag up stops there. */
  fullHeight?: () => number;
  /** The element that scrolls, when it is not the sheet itself. */
  scrollerRef?: RefObject<HTMLElement | null>;
};

type Gesture = "dismiss" | "resize" | "native";

/**
 * Google Maps' bottom-sheet drags, on phones (below Tailwind's `md`):
 *
 * - With its content scrolled to the top, dragging down moves the sheet rather
 *   than bouncing the content. At full height that shrinks it back to its
 *   smaller size; at the smaller size it closes it.
 * - At the smaller size, dragging up grows the sheet to full height rather
 *   than scrolling, provided there is more content to show.
 *
 * Letting go past 96 px, or with a flick, completes the step; a shorter drag
 * springs back. Any other gesture scrolls the content as usual, and a scroll
 * back up that reaches the top turns into a pull on the sheet mid-swipe.
 * Sheets using this set `overscroll-behavior: none`, so their content never
 * rubber-bands into a blank gap at the top.
 *
 * Touch events rather than pointer events: the move listener has to be
 * non-passive to stop iOS scrolling or rubber-banding the content, and
 * pointer events cannot do that.
 */
export function useBottomSheetDrag(
  sheetRef: RefObject<HTMLElement | null>,
  options: BottomSheetDragOptions
): void {
  // Read during the gesture, so a re-render mid-drag does not reset it.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const node: HTMLElement = sheet;

    let startY = 0;
    let startHeight = 0;
    /** Null until the gesture's first move decides what it is. */
    let gesture: Gesture | null = null;
    /** One finger on the phone sheet: a scroll may still become a drag. */
    let eligible = false;
    let lastY = 0;
    let travel = 0;
    /** Recent finger positions, for the speed at release. */
    let samples: { y: number; t: number }[] = [];
    let settleTimer: ReturnType<typeof setTimeout> | undefined;

    function isSheet(): boolean {
      return !window.matchMedia?.("(min-width: 48rem)").matches;
    }

    function scroller(): HTMLElement {
      return optionsRef.current.scrollerRef?.current ?? node;
    }

    function hasMoreToShow(): boolean {
      const el = scroller();
      return el.scrollHeight > el.clientHeight + 1;
    }

    function settle() {
      node.style.transition = `transform ${SETTLE_MS}ms ease-out, max-height ${SETTLE_MS}ms ease-out`;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        node.style.transition = "";
      }, SETTLE_MS);
    }

    function onTouchStart(event: TouchEvent) {
      eligible = event.touches.length === 1 && isSheet();
      if (!eligible) {
        gesture = "native";
        return;
      }
      startY = lastY = event.touches[0].clientY;
      samples = [{ y: startY, t: event.timeStamp }];
      gesture = null;
      travel = 0;
    }

    function decide(dy: number): Gesture {
      const { expanded, onExpandedChange } = optionsRef.current;
      const twoSizes = onExpandedChange !== undefined;
      if (dy > 0 && scroller().scrollTop <= 0) {
        return twoSizes && expanded ? "resize" : "dismiss";
      }
      if (dy < 0 && twoSizes && !expanded && hasMoreToShow()) return "resize";
      return "native";
    }

    function onTouchMove(event: TouchEvent) {
      if (!eligible || event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      const movingDown = y > lastY;
      lastY = y;
      if (gesture === "native") {
        // Google Maps' hand-off: a scroll back up that reaches the top of the
        // content carries on as a pull on the sheet, from where it is now,
        // rather than stopping (or bouncing) at the top.
        if (!movingDown || scroller().scrollTop > 0 || !event.cancelable) return;
        gesture = decide(1);
        if (gesture === "native") return;
        startY = y;
        samples = [{ y, t: event.timeStamp }];
        startHeight = node.getBoundingClientRect().height;
      }
      const dy = y - startY;
      if (gesture === null) {
        if (dy === 0) return;
        // Decided on the very first move, before iOS commits to a native
        // scroll. A scroll can still hand over to a pull at the top, above.
        gesture = decide(dy);
        if (gesture === "native") return;
        startHeight = node.getBoundingClientRect().height;
      }
      if (event.cancelable) event.preventDefault();
      samples.push({ y, t: event.timeStamp });
      samples = samples.filter((sample) => event.timeStamp - sample.t <= VELOCITY_WINDOW_MS);
      node.style.transition = "none";
      if (gesture === "dismiss") {
        travel = Math.max(0, dy);
        node.style.transform = travel > 0 ? `translateY(${travel}px)` : "";
      } else {
        const full = optionsRef.current.fullHeight?.() ?? window.innerHeight;
        const height = Math.min(full, Math.max(MIN_DRAG_HEIGHT_PX, startHeight - dy));
        travel = startHeight - height;
        node.style.maxHeight = `${height}px`;
      }
    }

    function onTouchEnd(event: TouchEvent) {
      const done = gesture;
      gesture = null;
      eligible = false;
      if (done === null || done === "native") return;
      const first = samples[0];
      const last = samples[samples.length - 1];
      // A finger that came to rest before lifting is not a flick.
      const rested = event.timeStamp - last.t > VELOCITY_WINDOW_MS;
      const velocity =
        !rested && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const { expanded, onExpandedChange } = optionsRef.current;
      settle();

      if (done === "dismiss") {
        if (travel >= SNAP_DISTANCE_PX || (travel > 0 && velocity >= SNAP_VELOCITY)) {
          node.style.transform = `translateY(${node.offsetHeight}px)`;
          settleTimer = setTimeout(() => optionsRef.current.onClose(), SETTLE_MS);
        } else {
          node.style.transform = "";
        }
        return;
      }

      // Resize: shrinking from full height (travel > 0) or growing from the
      // smaller size (travel < 0). Either way the size classes take over
      // again once the inline height goes, and the transition eases to them.
      const shrinking = travel > 0;
      const distance = Math.abs(travel);
      const flicked = shrinking ? velocity >= SNAP_VELOCITY : velocity <= -SNAP_VELOCITY;
      if (distance >= SNAP_DISTANCE_PX || (distance > 0 && flicked)) {
        onExpandedChange?.(!expanded);
      }
      // After React has applied the new size class, so the ease runs from the
      // dragged height straight to it.
      requestAnimationFrame(() => {
        node.style.maxHeight = "";
      });
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearTimeout(settleTimer);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [sheetRef]);
}

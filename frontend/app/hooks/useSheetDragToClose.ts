"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Pulled this far down, a released sheet closes. */
const CLOSE_DISTANCE_PX = 96;
/** Or flicked down at least this fast (px per ms) at the end of the pull. */
const CLOSE_VELOCITY = 0.5;
const SETTLE_MS = 180;

/**
 * Google Maps' bottom-sheet pull: with its content scrolled to the top, a
 * finger dragging down moves the whole sheet instead of bouncing the content
 * inside it, and letting go far enough down (or with a flick) closes it. A
 * short pull springs back. Any other gesture scrolls the content as usual.
 *
 * Phones only (below Tailwind's `md`), where the panel is a bottom sheet. Touch
 * events rather than pointer events: the move listener has to be non-passive
 * to stop iOS rubber-banding the content, and pointer events cannot do that.
 */
export function useSheetDragToClose(
  sheetRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  // Read at release, so a re-render mid-pull does not reset the gesture.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const node: HTMLElement = sheet;

    let startY = 0;
    /** Null until the gesture's first move decides what it is. */
    let dragging: boolean | null = null;
    let offset = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    function isSheet(): boolean {
      return !window.matchMedia?.("(min-width: 48rem)").matches;
    }

    function place(y: number, animate: boolean) {
      node.style.transition = animate ? `transform ${SETTLE_MS}ms ease-out` : "none";
      node.style.transform = y > 0 ? `translateY(${y}px)` : "";
    }

    function onTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1 || !isSheet()) {
        dragging = false;
        return;
      }
      startY = lastY = event.touches[0].clientY;
      lastTime = event.timeStamp;
      dragging = null;
      offset = 0;
      velocity = 0;
    }

    function onTouchMove(event: TouchEvent) {
      if (dragging === false || event.touches.length !== 1) return;
      const y = event.touches[0].clientY;
      const dy = y - startY;
      if (dragging === null) {
        if (dy === 0) return;
        // Decided on the very first move: iOS commits to a native scroll
        // straight after it, and then the gesture can no longer be taken over.
        dragging = dy > 0 && node.scrollTop <= 0;
        if (!dragging) return;
      }
      if (event.cancelable) event.preventDefault();
      const elapsed = event.timeStamp - lastTime;
      if (elapsed > 0) velocity = (y - lastY) / elapsed;
      lastY = y;
      lastTime = event.timeStamp;
      offset = Math.max(0, dy);
      place(offset, false);
    }

    function onTouchEnd() {
      if (!dragging) {
        dragging = null;
        return;
      }
      dragging = null;
      if (offset >= CLOSE_DISTANCE_PX || (offset > 0 && velocity >= CLOSE_VELOCITY)) {
        place(node.offsetHeight, true);
        closeTimer = setTimeout(() => onCloseRef.current(), SETTLE_MS);
      } else {
        place(0, true);
      }
    }

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearTimeout(closeTimer);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [sheetRef]);
}

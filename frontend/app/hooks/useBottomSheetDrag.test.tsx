/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBottomSheetDrag } from "./useBottomSheetDrag";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PEEK = 300;
const FULL = 600;

/** A two-size sheet whose content is taller than it, at a fixed peek height. */
function Sheet({ onClose, startExpanded = false }: { onClose: () => void; startExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(startExpanded);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useBottomSheetDrag(sheetRef, {
    onClose,
    expanded,
    onExpandedChange: setExpanded,
    scrollerRef,
    fullHeight: () => FULL,
  });
  return (
    <div
      ref={(node) => {
        sheetRef.current = node;
        if (node) node.getBoundingClientRect = () => ({ height: expanded ? FULL : PEEK }) as DOMRect;
      }}
      data-testid="sheet"
      data-expanded={expanded}
    >
      <div
        ref={(node) => {
          scrollerRef.current = node;
          if (!node) return;
          Object.defineProperty(node, "scrollHeight", { configurable: true, value: 2000 });
          Object.defineProperty(node, "clientHeight", { configurable: true, value: PEEK });
        }}
        data-testid="scroller"
      />
    </div>
  );
}

/** One finger from `from` to `to` (clientY), in six steps `stepMs` apart. */
function drag(el: HTMLElement, from: number, to: number, stepMs: number) {
  const touch = (clientY: number) => ({ touches: [{ clientY }] });
  fireEvent.touchStart(el, touch(from));
  for (let i = 1; i <= 6; i++) {
    vi.advanceTimersByTime(stepMs);
    fireEvent.touchMove(el, touch(from + ((to - from) * i) / 6));
  }
  fireEvent.touchEnd(el, { touches: [] });
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

describe("useBottomSheetDrag with two sizes", () => {
  it("grows to full height when pushed up from the peek", () => {
    render(<Sheet onClose={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    drag(sheet, 500, 300, 100);
    expect(sheet.dataset.expanded).toBe("true");
    expect(sheet.style.maxHeight).toBe("");
  });

  it("stays at the peek after a short, slow push", () => {
    render(<Sheet onClose={vi.fn()} />);
    const sheet = screen.getByTestId("sheet");
    drag(sheet, 500, 460, 100);
    expect(sheet.dataset.expanded).toBe("false");
  });

  it("scrolls the content instead once at full height", () => {
    render(<Sheet onClose={vi.fn()} startExpanded />);
    const sheet = screen.getByTestId("sheet");
    drag(sheet, 500, 300, 100);
    expect(sheet.dataset.expanded).toBe("true");
    expect(sheet.style.maxHeight).toBe("");
  });

  it("shrinks back to the peek when pulled down at full height", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} startExpanded />);
    const sheet = screen.getByTestId("sheet");
    drag(sheet, 300, 500, 100);
    expect(sheet.dataset.expanded).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("leaves a pull to the content while it is scrolled down", () => {
    render(<Sheet onClose={vi.fn()} startExpanded />);
    const sheet = screen.getByTestId("sheet");
    screen.getByTestId("scroller").scrollTop = 200;
    drag(sheet, 300, 500, 100);
    expect(sheet.dataset.expanded).toBe("true");
  });

  it("closes when pulled down at the peek", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} />);
    drag(screen.getByTestId("sheet"), 300, 500, 100);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("useBottomSheetDrag hand-off", () => {
  it("turns a scroll back up into a pull once the content reaches the top", () => {
    const onClose = vi.fn();
    render(<Sheet onClose={onClose} startExpanded />);
    const sheet = screen.getByTestId("sheet");
    const scroller = screen.getByTestId("scroller");
    const touch = (clientY: number) => ({ touches: [{ clientY }] });
    scroller.scrollTop = 60;
    fireEvent.touchStart(sheet, touch(300));
    // Scrolling back up: the content moves, not the sheet.
    for (const y of [320, 340, 360]) {
      vi.advanceTimersByTime(100);
      fireEvent.touchMove(sheet, touch(y));
    }
    expect(sheet.style.maxHeight).toBe("");
    // The content is at the top now; the same swipe carries on as a pull.
    scroller.scrollTop = 0;
    for (const y of [380, 430, 480, 530]) {
      vi.advanceTimersByTime(100);
      fireEvent.touchMove(sheet, touch(y));
    }
    expect(sheet.style.maxHeight).not.toBe("");
    fireEvent.touchEnd(sheet, { touches: [] });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(sheet.dataset.expanded).toBe("false");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes the one-size layers sheet the same way", () => {
    const onClose = vi.fn();
    function OneSize() {
      const ref = useRef<HTMLDivElement>(null);
      useBottomSheetDrag(ref, { onClose });
      return <div ref={ref} data-testid="one" />;
    }
    render(<OneSize />);
    const sheet = screen.getByTestId("one");
    const touch = (clientY: number) => ({ touches: [{ clientY }] });
    sheet.scrollTop = 40;
    fireEvent.touchStart(sheet, touch(300));
    vi.advanceTimersByTime(100);
    fireEvent.touchMove(sheet, touch(320));
    sheet.scrollTop = 0;
    for (const y of [360, 420, 480]) {
      vi.advanceTimersByTime(100);
      fireEvent.touchMove(sheet, touch(y));
    }
    fireEvent.touchEnd(sheet, { touches: [] });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("useBottomSheetDrag dismiss", () => {
  it("is gone before it could be put back, for an owner that unmounts it", () => {
    function Owner() {
      const [open, setOpen] = useState(true);
      return open ? <Unmounted onClose={() => setOpen(false)} /> : null;
    }
    function Unmounted({ onClose }: { onClose: () => void }) {
      const ref = useRef<HTMLDivElement>(null);
      useBottomSheetDrag(ref, { onClose });
      return <div ref={ref} data-testid="gone" />;
    }
    render(<Owner />);
    const sheet = screen.getByTestId("gone");
    drag(sheet, 300, 500, 100);
    expect(sheet.isConnected).toBe(false);
    // Still slid out: it was never moved back into view while on the page.
    expect(sheet.style.transform).toMatch(/^translateY/);
  });

  it("puts the sheet back once closed, for an owner that hides rather than unmounts it", () => {
    const onClose = vi.fn();
    function Hidden() {
      const ref = useRef<HTMLDivElement>(null);
      useBottomSheetDrag(ref, { onClose });
      return <div ref={ref} data-testid="kept" />;
    }
    render(<Hidden />);
    const sheet = screen.getByTestId("kept");
    drag(sheet, 300, 500, 100);
    expect(onClose).toHaveBeenCalledOnce();
    expect(sheet.style.transform).toBe("");
  });
});

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

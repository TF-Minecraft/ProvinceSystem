"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

import { pageScroller } from "./pageScroll";

const STORE_KEY = "tfmc:page-scroll";
/** Pages whose positions are kept for Back, Forward and reload. */
const MAX_POSITIONS = 50;
/** How long a returned-to position is held while the page's content loads in. */
const RESTORE_MS = 1000;
/** How long to wait for the returned-to page to render before restoring anyway. */
const RENDER_WAIT_MS = 300;
/** Input that hands the scroll back to the reader. */
const READER_INPUT = ["wheel", "pointerdown", "keydown", "touchstart"] as const;

function entryKey() {
  return `${location.pathname}${location.search}`;
}

function loadPositions(): Map<string, number> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "{}");
    return new Map(
      Object.entries(stored as Record<string, unknown>).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * The page below the site header. With a mouse or trackpad this area scrolls
 * rather than the document (globals.css), so the scrollbar starts beneath the
 * header. It takes over what the browser and Next only do for the document:
 * a new page starts at the top, and Back, Forward and reload return to where
 * the page was left.
 */
export default function PageScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  // Where the area was as of its last scroll event, before a navigation moved it.
  const settledTop = useRef(0);

  // For a new page Next zeroes the document's scrollTop, which leaves this area alone, then scrolls
  // the new segment into view. Part-way down a staff list, that would leave the next tab's page under
  // the pinned staff tabs. If Next moved the area, go to the top as the document would have.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || pageScroller() !== el || location.hash) return;
    if (el.scrollTop !== settledTop.current) el.scrollTop = 0;
  }, [pathname]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const positions = loadPositions();
    let cancelRestore = () => {};

    const hold = (top: number) => {
      const until = performance.now() + RESTORE_MS;
      let frame = 0;
      const stop = () => {
        cancelAnimationFrame(frame);
        for (const type of READER_INPUT) window.removeEventListener(type, stop, true);
        cancelRestore = () => {};
      };
      const step = () => {
        el.scrollTop = top;
        if (performance.now() < until) frame = requestAnimationFrame(step);
        else stop();
      };
      for (const type of READER_INPUT) window.addEventListener(type, stop, { capture: true, passive: true });
      cancelRestore = stop;
      step();
    };

    // Waits for the page being returned to, so the page being left does not jump first.
    const restore = (top: number | undefined) => {
      cancelRestore();
      if (top === undefined || pageScroller() !== el) return;
      const begin = () => {
        observer.disconnect();
        clearTimeout(timer);
        hold(top);
      };
      const observer = new MutationObserver(begin);
      observer.observe(el, { childList: true, subtree: true });
      const timer = setTimeout(begin, RENDER_WAIT_MS);
      cancelRestore = () => {
        observer.disconnect();
        clearTimeout(timer);
        cancelRestore = () => {};
      };
    };

    const onScroll = () => {
      settledTop.current = el.scrollTop;
      const key = entryKey();
      positions.delete(key);
      positions.set(key, el.scrollTop);
      if (positions.size > MAX_POSITIONS) {
        const oldest = positions.keys().next().value;
        if (oldest !== undefined) positions.delete(oldest);
      }
    };
    const onPopState = () => restore(positions.get(entryKey()));
    const save = () => {
      try {
        sessionStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(positions)));
      } catch {
        // Storage is full or blocked: reloads start at the top.
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pagehide", save);

    const [navigation] = performance.getEntriesByType?.("navigation") ?? [];
    const type = (navigation as PerformanceNavigationTiming | undefined)?.type;
    const reloadedTop = positions.get(entryKey());
    if ((type === "reload" || type === "back_forward") && reloadedTop !== undefined && pageScroller() === el) {
      hold(reloadedTop);
    }

    return () => {
      cancelRestore();
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  return (
    <div ref={ref} className="page-scroll">
      {children}
    </div>
  );
}

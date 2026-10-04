"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import SheetCloseButton from "./SheetCloseButton";

type PanelHeaderProps = {
  /** Banner, colour swatch or marker, left of the title. */
  visual: ReactNode;
  eyebrow: ReactNode;
  title: string;
  /** Owner, overlord or description under the title. */
  subtitle?: ReactNode;
  /** Centre the visual against the text rather than top-aligning it. */
  centred?: boolean;
  onClose: () => void;
};

/** Height of the pinned bar (`h-12`). */
const BAR_HEIGHT_PX = 48;

/** The nearest ancestor that scrolls: the panel's own body. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === "auto" || overflowY === "scroll") return el;
  }
  return null;
}

/**
 * A details panel's header, laid out like Google Maps' place sheet. The close
 * button sits in a bar pinned to the top of the panel. While the full header
 * is in view the bar is see-through, so the button simply sits in the
 * header's corner; once the title scrolls under it, the bar fills in and shows
 * the name, so the button stays part of a header rather than floating over
 * the content.
 */
export default function PanelHeader({
  visual,
  eyebrow,
  title,
  subtitle,
  centred = false,
  onClose,
}: PanelHeaderProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const heading = titleRef.current;
    const root = heading ? scrollParent(heading) : null;
    if (!heading || !root) return;
    const scroller: HTMLElement = root;
    let frame = 0;
    // A scroll listener rather than an IntersectionObserver: WebKit can hold
    // observer callbacks back until its next paint, leaving the bar a beat
    // behind the content.
    function update() {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      // The name moves into the bar as soon as the title has gone under it.
      // Never at rest: on a phone the title's foot sits near the bar's line.
      setCompact(
        scroller.scrollTop > 0 && heading!.getBoundingClientRect().bottom <= top + BAR_HEIGHT_PX
      );
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      {/* Zero height and pinned at the very top of the panel body, which has
          no top padding: with none, Safari and Chrome agree where a sticky
          bar rests, so it neither takes room from the header nor moves (or
          leaves a gap above it) when it starts to stick. */}
      <div className="sticky top-0 z-10 h-0">
        <div
          className={`absolute -inset-x-4 top-0 flex h-12 items-center gap-2 border-b px-4 transition-colors duration-150 md:rounded-t-[9px] ${
            compact
              ? // The upward shadow seals the hairline iOS can leave above it.
                "pointer-events-auto border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] bg-[var(--tfmc-forest-deep)] shadow-[0_-4px_0_var(--tfmc-forest-deep)]"
              : "pointer-events-none border-transparent"
          }`}
        >
          <p
            aria-hidden
            className={`min-w-0 flex-1 truncate font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)] transition-opacity duration-150 ${
              compact ? "opacity-100" : "opacity-0"
            }`}
          >
            {title}
          </p>
          <SheetCloseButton onClick={onClose} label="Close details" />
        </div>
      </div>
      <header
        className={`map-frame-header -mx-4 mb-4 flex gap-4 rounded-t-[9px] px-4 pb-4 pt-1 md:pt-4 ${
          centred ? "items-center" : ""
        }`}
      >
        {visual}
        <div className="min-w-0 flex-1 pr-9">
          <p className="text-xs text-[var(--tfmc-mist)]">{eyebrow}</p>
          <h2
            ref={titleRef}
            className="font-[family-name:var(--font-fraunces)] text-2xl leading-tight text-[var(--tfmc-cream)]"
          >
            {title}
          </h2>
          {subtitle}
        </div>
      </header>
    </>
  );
}

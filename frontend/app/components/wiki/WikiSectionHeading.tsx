import type { ReactNode } from "react";

import { cx, wikiBodyText, wikiDisplayFont } from "./wikiStyles";

export interface WikiSectionHeadingProps {
  /** The `<h2>` text. */
  children: ReactNode;
  /**
   * Anchor id, so the section can be deep-linked as `/wiki/foo#commands`.
   * Scroll offset for the sticky site header is handled here.
   */
  id?: string;
  /** Optional lead-in paragraph rendered directly under the heading. */
  intro?: ReactNode;
}

/**
 * An `<h2>` with the wiki's spacing and font treatment, plus an optional anchor
 * id for deep links. Use one per section; don't hand-roll `<h2>` on a page.
 */
export default function WikiSectionHeading({ children, id, intro }: WikiSectionHeadingProps) {
  return (
    <>
      <h2
        id={id}
        className={cx(
          "mt-8 scroll-mt-[calc(var(--tfmc-sticky-top)+1rem)]",
          wikiDisplayFont,
          "text-xl text-[var(--tfmc-cream)]",
        )}
      >
        {children}
      </h2>
      {intro ? <p className={cx("mt-1", wikiBodyText)}>{intro}</p> : null}
    </>
  );
}

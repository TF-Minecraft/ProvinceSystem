import type { ReactNode } from "react";

import { cx, wikiBodyText, wikiDisplayFont } from "./wikiStyles";

/** Reading width of the page body. Prose pages are `md`; table/grid-heavy pages are `lg`. */
export type WikiPageWidth = "sm" | "md" | "lg";

export interface WikiPageProps {
  /** The `<h1>`. Should match the page's `WikiNavItem.label`. */
  title: ReactNode;
  /** One or two sentences under the title. Inline markup (code, links) is fine. */
  intro?: ReactNode;
  /**
   * ISO calendar date for a page-specific content revision. Pages without an
   * override use the maintained wiki-wide revision date below.
   */
  lastModified?: string;
  /** Optional visual shown beside the title, such as an item icon. */
  titleVisual?: ReactNode;
  /** Optional navigation or context shown immediately before the title. */
  beforeTitle?: ReactNode;
  /** `sm` = 2xl, `md` = 3xl (default), `lg` = 4xl. */
  width?: WikiPageWidth;
  children?: ReactNode;
}

const WIDTHS: Record<WikiPageWidth, string> = {
  sm: "max-w-2xl",
  md: "max-w-3xl",
  lg: "max-w-4xl",
};

/**
 * Date of the latest wiki-wide content revision. This is deliberately
 * maintained in source instead of being computed from the visitor's clock.
 */
export const WIKI_LAST_MODIFIED = "2026-09-12";

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * The standard wiki page frame: `<article>` + `<h1>` + optional intro and
 * "last modified" note. Every `/wiki/*` page body should start here so titles,
 * spacing and reading width stay identical across ~40 pages.
 */
export default function WikiPage({
  title,
  intro,
  lastModified,
  titleVisual,
  beforeTitle,
  width = "md",
  children,
}: WikiPageProps) {
  const modifiedDate = lastModified && isIsoCalendarDate(lastModified)
    ? lastModified
    : WIKI_LAST_MODIFIED;

  return (
    <article className={WIDTHS[width]}>
      {beforeTitle}
      <div className={titleVisual ? "mt-3 flex items-center gap-4" : undefined}>
        {titleVisual}
        <h1 className={cx(wikiDisplayFont, "text-3xl text-[var(--tfmc-cream)] sm:text-4xl")}>
          {title}
        </h1>
      </div>
      {intro ? <p className={cx("mt-2", wikiBodyText)}>{intro}</p>: null}
      <p className="mt-2 text-xs text-[var(--tfmc-stone)]">
        Last modified: <time dateTime={modifiedDate}>{modifiedDate}</time>
      </p>
      {children}
    </article>
  );
}

import Link from "next/link";

import { getNavItemByHref } from "@/app/wiki/data";

import { cx, wikiCard, wikiDisplayFont } from "./wikiStyles";

export interface SeeAlsoProps {
  /**
   * Routes of related pages, e.g. `["/wiki/stations", "/wiki/materials"]`.
   * Each label is resolved from the nav registry, so link text can never drift
   * from the real page title.
   */
  hrefs: string[];
  /** Heading and landmark name. Defaults to `"See also"`. */
  title?: string;
  /** Hide the one-line blurb under each link. */
  hideBlurbs?: boolean;
  className?: string;
}

/**
 * An href with no registered page is a broken cross-link. In development (and in
 * tests) that throws immediately: the author sees it the moment the page
 * renders. In a production build it degrades to a loud red placeholder rather
 * than taking the whole page down, but it is never silently dropped and never
 * given a guessed label.
 */
function unresolved(href: string) {
  if (process.env.NODE_ENV !== "production") {
    throw new Error(
      `SeeAlso: "${href}" is not a registered wiki page. Add its WikiSection to ` +
        `app/wiki/data/registry.ts, or fix the href: link labels are resolved ` +
        `from the nav registry and are never hand-written.`,
    );
  }
  return (
    <li key={href} role="alert" className="text-sm font-bold text-[#ff5f5f]">
      Broken wiki link: {href} is not a registered page.
    </li>
  );
}

/**
 * The cross-linking block that keeps this wiki densely interlinked. Renders a
 * real `<nav>` landmark containing a list, with every label (and blurb, and
 * draft marker) pulled from the page's own `WikiNavItem`.
 */
export default function SeeAlso({ hrefs, title = "See also", hideBlurbs, className }: SeeAlsoProps) {
  return (
    <nav aria-label={title} className={cx("mt-10", className)}>
      <h2 className={cx(wikiDisplayFont, "text-xl text-[var(--tfmc-cream)]")}>{title}</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {hrefs.map((href) => {
          const item = getNavItemByHref(href);
          if (!item) return unresolved(href);

          return (
            <li key={href}>
              <Link
                href={item.href}
                className={cx(wikiCard, "block transition-colors hover:border-[var(--tfmc-accent)]")}
              >
                <span
                  className={cx(wikiDisplayFont, "flex flex-wrap items-center gap-2 text-lg text-[var(--tfmc-cream)]")}
                >
                  {item.label}
                </span>
                {hideBlurbs ? null : <span className="mt-1 block text-sm text-[var(--tfmc-mist)]">{item.blurb}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

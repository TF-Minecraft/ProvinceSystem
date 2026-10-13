/** Screens whose page scrolls in PageScroll's area rather than the document (see globals.css). */
export const PAGE_SCROLL_QUERY = "(hover: hover) and (pointer: fine)";

/** The element the page scrolls in: PageScroll's area with a mouse or trackpad, the document on touch screens. */
export function pageScroller(): HTMLElement {
  const area = document.querySelector<HTMLElement>(".page-scroll");
  if (area && window.matchMedia?.(PAGE_SCROLL_QUERY).matches) return area;
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

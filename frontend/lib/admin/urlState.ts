/**
 * Change the page's query without a navigation. Next.js keeps
 * `useSearchParams` in step with the native history API, and skipping the
 * router means dragging the timeline or ticking a player does not ask the
 * server for the page again.
 */
export function writeUrl(url: string, replace: boolean): void {
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}

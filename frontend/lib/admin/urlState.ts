/**
 * Change the page's query without a navigation. Next.js keeps
 * `useSearchParams` in step with the native history API, and skipping the
 * router means dragging the timeline or ticking a player does not ask the
 * server for the page again.
 *
 * Safari throws a SecurityError past 100 history calls in 10 seconds (and
 * Next.js makes its own call after each of ours), which took the page down
 * while scrubbing. Writes are kept to WRITES_PER_WINDOW per window; past
 * that, the latest is held and written once the window allows.
 */
const WINDOW_MS = 10_000;
const WRITES_PER_WINDOW = 30;

let recent: number[] = [];
let held: { url: string; replace: boolean } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function write(url: string, replace: boolean): void {
  try {
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
  } catch {
    // Over the browser's limit after all: this change stays out of the URL, the page carries on.
  }
}

function flush(): void {
  timer = null;
  const next = held;
  held = null;
  if (next) writeUrl(next.url, next.replace);
}

export function writeUrl(url: string, replace: boolean): void {
  const now = Date.now();
  recent = recent.filter((t) => now - t < WINDOW_MS);
  if (!timer && recent.length < WRITES_PER_WINDOW) {
    recent.push(now);
    write(url, replace);
    return;
  }
  // Keep the latest; a held push stays a push, so the history entry is not lost.
  held = { url, replace: replace && (held?.replace ?? true) };
  if (!timer) timer = setTimeout(flush, Math.max(50, WINDOW_MS - (now - recent[0])));
}

/** For tests. */
export function resetUrlWrites(): void {
  recent = [];
  held = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

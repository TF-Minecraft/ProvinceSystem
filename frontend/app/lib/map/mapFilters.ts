/**
 * Whether CSS filters can be used on the map's overlays.
 *
 * WebKit does not draw a filtered image inside the scaled map: the highlight
 * of a selected or hovered region (brightness and a drop-shadow rim), and an
 * opened realm drawn as one filtered group, rendered as nothing at all. That
 * is Safari, and every browser on iOS, which must use WebKit; their user agents
 * say AppleWebKit without naming Chromium's or Firefox's own engines.
 */
export function mapFiltersSupported(userAgent: string): boolean {
  if (!/AppleWebKit/.test(userAgent)) return true;
  return /Chrome\/|Chromium\/|Edg\/|OPR\//.test(userAgent);
}

export function mapFiltersSupportedHere(): boolean {
  return typeof navigator === "undefined" || mapFiltersSupported(navigator.userAgent);
}

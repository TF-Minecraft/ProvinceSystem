/**
 * Whether the page runs on WebKit's own engine: Safari, and every browser on
 * iOS, which must use WebKit. Their user agents say AppleWebKit without naming
 * Chromium's or Firefox's own engines.
 */
export function usesWebKitEngine(userAgent: string): boolean {
  if (!/AppleWebKit/.test(userAgent)) return false;
  return !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(userAgent);
}

/**
 * Whether CSS filters can be used on the map's overlays.
 *
 * WebKit does not draw a filtered image inside the scaled map: the highlight
 * of a selected or hovered region (brightness and a drop-shadow rim), and an
 * opened realm drawn as one filtered group, rendered as nothing at all.
 */
export function mapFiltersSupported(userAgent: string): boolean {
  return !usesWebKitEngine(userAgent);
}

export function mapFiltersSupportedHere(): boolean {
  return typeof navigator === "undefined" || mapFiltersSupported(navigator.userAgent);
}

/**
 * Whether the realm names can be scaled with a transform rather than CSS
 * `zoom` (see `MapViewport`'s `unzoomed`).
 *
 * Not on WebKit: there the names' full-size (6400 px) layer would get a
 * backing store at that size whenever something composited it, the memory
 * blow-up `restingZoom` exists to avoid.
 */
export function unzoomedLabelsSupported(userAgent: string): boolean {
  return !usesWebKitEngine(userAgent);
}

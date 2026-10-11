/**
 * The handful of Tailwind class strings the wiki repeats everywhere, named once.
 *
 * These are the exact idioms already used by the hand-written wiki pages (see
 * `app/wiki/README.md` → "Styling tokens"). Components in this folder build on
 * them instead of re-typing the `color-mix(...)` strings, so a tweak lands on
 * every page at once. Only the documented `--tfmc-*` custom properties are used.
 */

/** Display font used by every wiki heading. */
export const wikiDisplayFont = "font-[family-name:var(--font-fraunces)]";

/** Default body copy. */
export const wikiBodyText = "text-sm text-[var(--tfmc-mist)]";

/** Quiet 1px hairline used for panels, table shells and card edges. */
export const wikiHairline = "border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]";

/** The standard wiki card/panel surface. */
export const wikiCard =
  "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,transparent)] p-4";

/** Table header band. */
export const wikiTableHead = "bg-[color-mix(in_srgb,var(--tfmc-forest)_60%,transparent)] text-[var(--tfmc-cream)]";

/** Divider between table rows. */
export const wikiRowDivider = "border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]";

/**
 * Height of a full-size block preview in the wiki.
 *
 * Every branch that can occupy a preview slot must resolve to this exact
 * height — `StationModelViewer`, `SimpleCubeViewer`, and the "standard block
 * appearance" fallback in the stations gallery. If they drift apart, switching
 * between stations moves everything below the preview. Named here so the three
 * of them cannot be changed independently by accident.
 */
export const wikiBlockPreviewHeight = "h-64 sm:h-80";

/** Pixel-art item/block icons must never be smoothed. */
export const wikiPixelIcon = "[image-rendering:pixelated]";

/** Join class names, dropping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Map chrome. Every floating control on the world map shares one quiet panel
 * style, the same forest and cream as the rest of the site, so the map stays
 * the thing being looked at. The timelapse reuses it.
 *
 * Each string leaves out what a caller may set instead (position, corners,
 * border width), as two Tailwind classes for one property do not reliably
 * resolve in the order they are written.
 */

/** A floating panel. It sets no position: add `relative` unless the panel is placed. */
export const mapFrameClass =
  "rounded-[10px] border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_94%,transparent)] text-[var(--tfmc-cream)] shadow-[0_8px_24px_rgb(0_0_0/0.35)] backdrop-blur-[8px]";

/** A panel's header strip. */
export const mapFrameHeaderClass =
  "border-b border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]";

/**
 * A control's colours and states, without corners or an outline: the zoom
 * buttons, joined in one panel, use it alone. A control stays lit while
 * pressed or open, and a hover shows over that.
 */
export const mapControlFaceClass =
  "inline-flex items-center justify-center gap-[0.4rem] border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_94%,transparent)] text-[var(--tfmc-stone)] transition-[color,border-color,background-color] duration-[120ms] ease-[ease] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] aria-expanded:border-transparent aria-expanded:bg-[color-mix(in_srgb,var(--tfmc-cream)_92%,transparent)] aria-expanded:text-[var(--tfmc-forest-deep)] aria-pressed:border-transparent aria-pressed:bg-[color-mix(in_srgb,var(--tfmc-cream)_92%,transparent)] aria-pressed:text-[var(--tfmc-forest-deep)] disabled:cursor-default disabled:opacity-45 [&:hover:not(:disabled)]:border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] [&:hover:not(:disabled)]:bg-[color-mix(in_srgb,var(--tfmc-forest)_94%,transparent)] [&:hover:not(:disabled)]:text-[var(--tfmc-cream)]";

/** Rectangular controls: layers, panel buttons, links. */
export const mapControlClass = `${mapControlFaceClass} rounded-[8px] border`;

/** Round controls: the layers button, the timelapse's back and step buttons. */
export const mapRoundControlClass = `${mapControlFaceClass} rounded-full border`;

/** A realm's banner. Add the forest background unless the banner sets its own. */
export const mapBannerFrameClass =
  "overflow-hidden rounded-[4px] border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]";

/** An in-text link to another realm or place. */
export const mapLinkClass =
  "text-[var(--tfmc-cream)] underline decoration-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] underline-offset-2 [&:hover]:decoration-[var(--tfmc-cream)]";

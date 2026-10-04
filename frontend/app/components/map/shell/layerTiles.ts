/**
 * The square picture tiles of Google Maps' layers panel, shared by the map's
 * layers menu and the timelapse studio's layer picker so the two read as one
 * control: a rounded frame, ringed in the accent when on, with its label under.
 */

export const layerTileButtonClass =
  "group flex w-full flex-col items-center gap-1.5 rounded-lg px-0.5 py-1 text-center focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] disabled:cursor-not-allowed disabled:opacity-45";

export const layerTileFrameClass =
  "relative block aspect-square w-full max-w-[4.25rem] overflow-hidden rounded-xl transition-shadow";

export function layerTileRingClass(active: boolean): string {
  return active
    ? "ring-[3px] ring-[var(--tfmc-accent)] ring-offset-2 ring-offset-[var(--tfmc-forest-deep)]"
    : "ring-1 ring-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] group-hover:group-enabled:ring-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)]";
}

/** An overlay's tile: its icon on a plain ground, tinted while it is on. */
export function layerTileIconClass(active: boolean): string {
  return `flex items-center justify-center ${
    active
      ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_28%,var(--tfmc-forest-deep))] text-[var(--tfmc-cream)]"
      : "bg-[color-mix(in_srgb,var(--tfmc-cream)_7%,transparent)] text-[var(--tfmc-mist)]"
  }`;
}

export function layerTileLabelClass(active: boolean): string {
  return `block text-xs leading-tight hyphens-auto ${
    active ? "font-semibold text-[var(--tfmc-accent)]" : "text-[var(--tfmc-stone)]"
  }`;
}

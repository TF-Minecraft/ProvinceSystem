import { CloseIcon } from "./MapIcons";

type SheetCloseButtonProps = {
  onClick: () => void;
  label: string;
  className?: string;
};

/**
 * Google Maps' round close button, the same on every map sheet and panel.
 * Filled rather than outlined, so it stays readable over content scrolling
 * under it.
 */
export default function SheetCloseButton({ onClick, label, className = "" }: SheetCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_14%,var(--tfmc-forest-deep))] text-[var(--tfmc-cream)] shadow-[0_2px_8px_rgb(0_0_0/0.35)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_24%,var(--tfmc-forest-deep))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] ${className}`}
    >
      <CloseIcon size={18} />
    </button>
  );
}

/**
 * The details panels' close button, pinned to the panel's top right corner:
 * it stays put while the panel scrolls, as Google Maps' does. A zero-height
 * sticky row at the top of the panel, so it takes no room from the header.
 */
export function PanelCloseButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="sticky top-1 z-10 h-0 md:top-4">
      <SheetCloseButton
        onClick={onClick}
        label="Close details"
        className="absolute -right-1 top-2 md:-top-1"
      />
    </div>
  );
}

import { CloseIcon } from "./MapIcons";

type SheetCloseButtonProps = {
  onClick: () => void;
  label: string;
  className?: string;
};

/**
 * Google Maps' close button, the same on every map sheet and panel: a plain
 * cross in the header bar, highlighted only under a mouse. Pulled 12 px into
 * the bar's right padding, so the cross itself sits as far from the edge as
 * the title does on the left, rather than its tap target's edge.
 */
export default function SheetCloseButton({ onClick, label, className = "" }: SheetCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`pointer-events-auto -mr-3 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--tfmc-cream)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] ${className}`}
    >
      <CloseIcon size={22} />
    </button>
  );
}

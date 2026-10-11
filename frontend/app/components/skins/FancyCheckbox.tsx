type Props = {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  "aria-label"?: string;
};

/** Accessible checkbox with TFMC styling (native input, custom face). */
export default function FancyCheckbox({
  checked,
  disabled = false,
  onChange,
  className = "",
  "aria-label": ariaLabel,
}: Props) {
  return (
    <span className={`relative mt-0.5 inline-flex h-4 w-4 shrink-0 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <span
        aria-hidden
        className="pointer-events-none flex h-4 w-4 items-center justify-center rounded-[3px] border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,black)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] transition peer-hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,var(--tfmc-cream))] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--tfmc-accent)] peer-checked:border-[var(--tfmc-accent)] peer-checked:bg-[var(--tfmc-accent)] peer-checked:shadow-none peer-checked:[&_svg]:opacity-100 peer-disabled:opacity-40"
      >
        <svg
          viewBox="0 0 12 12"
          className="h-2.5 w-2.5 text-[var(--tfmc-forest-deep)] opacity-0 transition-opacity"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 6.2 4.8 8.5 9.5 3.5" />
        </svg>
      </span>
    </span>
  );
}

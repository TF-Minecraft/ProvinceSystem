import type { ReactNode } from "react";

import { cx, wikiBodyText, wikiDisplayFont } from "./wikiStyles";

export type CalloutVariant = "note" | "warning" | "bug" | "draft" | "staff";

export interface CalloutProps {
  /** Defaults to `"note"`. */
  variant?: CalloutVariant;
  /** Overrides the variant's default label text. The label is always rendered. */
  title?: ReactNode;
  children: ReactNode;
  /** Extra classes on the outer box: spacing only, please. */
  className?: string;
}

type VariantStyle = {
  label: string;
  /** Classes on the outer box. */
  box: string;
  /** Classes on the label element. */
  labelClass: string;
};

const VARIANTS: Record<CalloutVariant, VariantStyle> = {
  note: {
    label: "Note",
    box: "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,transparent)] p-4",
    labelClass: "text-sm uppercase tracking-widest text-[var(--tfmc-cream)]",
  },
  warning: {
    label: "Warning",
    box: "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_25%,transparent)] p-4",
    labelClass:
      "inline-block rounded bg-[var(--tfmc-accent)] px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-[var(--tfmc-forest)]",
  },
  bug: {
    label: "Known bug",
    box: "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] p-4",
    labelClass:
      "inline-block rounded bg-[var(--tfmc-accent)] px-2 py-0.5 text-xs font-bold uppercase tracking-widest text-[var(--tfmc-forest)]",
  },
  draft: {
    label: "Draft: unverified",
    box: "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_18%,transparent)] p-4",
    labelClass: "text-sm uppercase tracking-widest text-[var(--tfmc-cream)]",
  },
  staff: {
    label: "Staff only",
    box: "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-stone)_25%,transparent)] p-4",
    labelClass: "text-sm uppercase tracking-widest text-[var(--tfmc-cream)]",
  },
};

/**
 * A boxed aside. Use it to flag anything the reader must not skim past:
 * unverified numbers (`draft`), gotchas (`warning`), things that are actually
 * broken on the live server (`bug`), or information only staff can act on
 * (`staff`).
 */
export default function Callout({ variant = "note", title, children, className }: CalloutProps) {
  const style = VARIANTS[variant];
  const label = title ?? style.label;

  return (
    <div role="note" data-variant={variant} className={cx("mt-4", style.box, className)}>
      <p className={cx(wikiDisplayFont, style.labelClass)}>{label}</p>
      <div className={cx("mt-1", wikiBodyText)}>{children}</div>
    </div>
  );
}

/** Styles and pieces shared by the player profile's sections. */

export const panelClass =
  "mt-6 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-5";
export const headingClass = "font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]";
export const moreClass =
  "mt-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] px-3 py-1.5 text-sm text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)] disabled:opacity-40";
export const mutedClass = "text-sm text-[var(--tfmc-mist)]";
export const errorClass = "mt-3 text-sm text-[#e8a0a0]";
export const dayHeadingClass = "text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]";
export const dividerClass = "divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]";

export type Failure = { message: string; before: string | null };

export function Retry({ failure, busy, onRetry }: { failure: Failure; busy: boolean; onRetry: () => void }) {
  return (
    <div>
      <p className={errorClass} role="alert">
        {failure.message}
      </p>
      <button type="button" className={moreClass} disabled={busy} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

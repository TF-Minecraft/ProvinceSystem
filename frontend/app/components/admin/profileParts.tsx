/** Styles and pieces shared by the player profile's sections. */

export const moreClass =
  "mt-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] px-3 py-1.5 text-sm text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)] disabled:opacity-40";
const errorClass = "mt-3 text-sm text-[#e8a0a0]";
export const dayHeadingClass = "text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]";

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

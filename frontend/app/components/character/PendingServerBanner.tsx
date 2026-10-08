"use client";

type Props = {
  className?: string;
};

export default function PendingServerBanner({ className = "" }: Props) {
  return (
    <div
      className={`rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_10%,transparent)] px-4 py-3 text-sm text-[var(--tfmc-cream)] ${className}`.trim()}
      role="status"
    >
      Being added to the server…
    </div>
  );
}

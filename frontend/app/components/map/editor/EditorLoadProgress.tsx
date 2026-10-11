type EditorLoadProgressProps = {
  percent: number;
  label: string;
};

export default function EditorLoadProgress({ percent, label }: EditorLoadProgressProps) {
  const clampedPercent = Math.max(0, Math.min(100, percent));

  return (
    <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_35%,var(--tfmc-forest-deep))] p-6 shadow-lg">
      <p className="text-sm text-[var(--tfmc-mist)]">
        {clampedPercent}% - {label}
      </p>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clampedPercent}
        aria-label={label}
        className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,transparent)]"
      >
        <div
          className="h-full rounded-full bg-[var(--tfmc-accent)] transition-[width] duration-200"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    </div>
  );
}

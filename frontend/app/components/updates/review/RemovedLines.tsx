"use client";

import type { ReviewBullet } from "@/lib/patchnotes/review";

import { reviewButtonClass } from "./ReviewLine";

type RemovedLinesProps = {
  bullets: ReviewBullet[];
  disabled: boolean;
  errors: Record<string, string>;
  onRestore: (bullet: ReviewBullet) => void;
};

export default function RemovedLines({ bullets, disabled, errors, onRestore }: RemovedLinesProps) {
  return (
    <details className="mt-5 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]">
      <summary className="cursor-pointer py-2 text-sm font-semibold text-[var(--tfmc-cream)]">
        Removed ({bullets.length})
      </summary>
      <div>
        {bullets.map((bullet) => (
          <div
            key={bullet.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b
              border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] py-1.5 text-sm
              text-[var(--tfmc-stone)]"
          >
            <span className="min-w-0 flex-1 whitespace-pre-wrap">{bullet.body}</span>
            <button
              className={reviewButtonClass}
              type="button"
              disabled={disabled}
              onClick={() => onRestore(bullet)}
            >
              Restore
            </button>
            {errors[bullet.id] && (
              <p role="alert" className="w-full text-xs text-[var(--tfmc-accent)]">
                {errors[bullet.id]}
              </p>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

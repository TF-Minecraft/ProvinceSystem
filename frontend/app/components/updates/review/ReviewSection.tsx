"use client";

import { SECTION_LABELS, type SectionName } from "@/lib/patchnotes/notes";
import { patchReviewBullet, type ReviewBullet } from "@/lib/patchnotes/review";

import ReviewLine from "./ReviewLine";

type ReviewSectionProps = {
  section: SectionName;
  bullets: ReviewBullet[];
  matchCount: number;
  filtering: boolean;
  disabled: boolean;
  lineErrors: Record<string, string>;
  onPatch: (bullet: ReviewBullet, patch: Parameters<typeof patchReviewBullet>[2]) => void;
  onDrop: (bullet: ReviewBullet) => void;
  onError: (id: string, text: string) => void;
};

export default function ReviewSection({
  section,
  bullets,
  matchCount,
  filtering,
  disabled,
  lineErrors,
  onPatch,
  onDrop,
  onError,
}: ReviewSectionProps) {
  const open = filtering ? matchCount > 0 : section !== "technical";
  const summary = filtering
    ? `${SECTION_LABELS[section]} (${bullets.length} ${bullets.length === 1 ? "match" : "matches"})`
    : `${SECTION_LABELS[section]} (${bullets.length})`;

  return (
    <details
      open={open}
      className="border-b border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]"
    >
      <summary className="cursor-pointer py-2 font-semibold text-sm text-[var(--tfmc-cream)]">
        {summary}
      </summary>
      <div>
        {bullets.map((bullet) => (
          <ReviewLine
            key={bullet.id}
            bullet={bullet}
            disabled={disabled}
            error={lineErrors[bullet.id]}
            onPatch={(patch) => onPatch(bullet, patch)}
            onDrop={() => onDrop(bullet)}
            onError={onError}
          />
        ))}
      </div>
    </details>
  );
}

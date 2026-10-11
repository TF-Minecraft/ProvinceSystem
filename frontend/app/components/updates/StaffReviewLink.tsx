"use client";

import Link from "next/link";

export default function StaffReviewLink({ staff }: { staff: boolean }) {
  if (!staff) return null;

  return (
    <p className="mt-4 text-sm">
      <Link
        href="/updates/review"
        className="text-[var(--tfmc-accent)] underline
          decoration-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] underline-offset-4
          hover:text-[var(--tfmc-cream)]"
      >
        Review this week&apos;s notes
      </Link>
    </p>
  );
}

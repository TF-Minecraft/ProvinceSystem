"use client";

import Link from "next/link";

export type MapAccessGateReason = "login" | "permission" | "unknown";

type MapAccessGateProps = {
  reason: MapAccessGateReason;
  mapDisplayName?: string;
};

export default function MapAccessGate({
  reason,
  mapDisplayName = "this map",
}: MapAccessGateProps) {
  const title =
    reason === "login"
      ? "Sign in to view this map"
      : reason === "permission"
        ? "Staff only"
        : "Unable to load map";

  const body =
    reason === "login"
      ? "Sign in with your profile code on the Profile page."
      : reason === "permission"
        ? "If you should have access, ask staff."
        : `Something went wrong while loading ${mapDisplayName}. Please try again later.`;

  return (
    <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)] px-6">
      <div className="max-w-lg text-center">
        <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-medium text-[var(--tfmc-cream)]">
          {title}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--tfmc-stone)]">
          {body}
        </p>
        {(reason === "login" || reason === "permission") && (
          <Link
            href="/profile"
            className="mt-6 inline-flex rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_40%,var(--tfmc-forest-deep))] px-4 py-2 text-sm font-medium text-[var(--tfmc-cream)] transition-colors hover:text-white"
          >
            Go to Profile
          </Link>
        )}
      </div>
    </div>
  );
}

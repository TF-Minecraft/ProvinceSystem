import { Skeleton } from "@/app/components/shared/LoadingSkeleton";

export default function Loading() {
  return (
    <main className="mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] w-full max-w-3xl px-6 py-16">
      <div role="status" aria-busy="true" aria-label="Loading updates…">
        <span className="sr-only">Loading updates…</span>
        <div aria-hidden="true" className="motion-safe:animate-pulse">
          <Skeleton className="h-10 w-40" />
          <div className="mt-10 flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map((week) => (
              <div
                key={week}
                className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] px-6 py-4"
              >
                <Skeleton className="h-5 w-56 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

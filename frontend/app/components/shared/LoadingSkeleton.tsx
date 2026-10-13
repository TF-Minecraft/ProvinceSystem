import { useId } from "react";

type Variant = "content" | "article" | "form" | "list" | "table" | "model" | "map" | "chart" | "line";

/** The same muted blocks used by the Profile outline. */
export function Skeleton({ className = "", round = "rounded-sm" }: { className?: string; round?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] ${round} ${className}`}
    />
  );
}

function Outline({ variant }: { variant: Variant }) {
  if (variant === "line") return <Skeleton className="h-4 w-40 max-w-full" />;

  if (variant === "model") {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 p-3">
        <Skeleton className="h-28 max-h-[70%] w-24 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full shrink-0" />
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className="flex h-40 items-end gap-3 border-b border-l border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] p-3">
        {["h-1/3", "h-2/3", "h-1/2", "h-3/4", "h-2/3", "h-full"].map((height, i) => (
          <Skeleton key={i} className={`${height} min-w-0 flex-1`} />
        ))}
      </div>
    );
  }

  if (variant === "map") {
    return (
      <div className="relative h-full min-h-0 overflow-hidden bg-[var(--tfmc-forest-deep)]">
        <Skeleton className="absolute inset-0 opacity-40" round="" />
        <div className="absolute top-4 left-4 right-4 flex gap-3">
          <Skeleton className="h-10 w-64 max-w-[60%]" />
          <Skeleton className="h-10 w-24" />
        </div>
        <div className="absolute top-20 left-4 hidden w-64 space-y-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[var(--tfmc-forest-deep)] p-4 sm:block">
          <Skeleton className="h-5 w-32" />
          <Outline variant="list" />
        </div>
        <div className="absolute right-4 bottom-4 space-y-2">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-10 w-10" />
        </div>
        <Skeleton className="absolute bottom-4 left-4 h-4 w-32" />
      </div>
    );
  }

  if (variant === "form") {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56 max-w-full" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-11 w-full" />
          </div>
        ))}
        <Skeleton className="h-11 w-32" />
      </div>
    );
  }

  if (variant === "list" || variant === "table") {
    return (
      <div className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 py-4">
            {variant === "list" ? <Skeleton className="h-10 w-10 shrink-0" /> : null}
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3.5 w-72 max-w-full" />
            </div>
            {variant === "table" ? (
              <>
                <Skeleton className="hidden h-4 w-24 sm:block" />
                <Skeleton className="h-4 w-16 shrink-0" />
              </>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Skeleton className="h-9 w-64 max-w-full sm:h-10" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {variant === "article" ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="mb-4 h-6 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))
      ) : (
        <Outline variant="list" />
      )}
    </div>
  );
}

/** Announce one loading message; decorative placeholders never become controls. */
export default function LoadingSkeleton({
  variant = "content",
  label = "Loading…",
  className = "",
}: {
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  const labelId = useId();
  return (
    <div role="status" aria-busy="true" aria-labelledby={labelId} className={className}>
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <div aria-hidden="true" className="h-full motion-safe:animate-pulse">
        <Outline variant={variant} />
      </div>
    </div>
  );
}

export function PageSkeleton({
  variant = "content",
  label = "Loading page…",
  className = "max-w-3xl py-16",
}: {
  variant?: Variant;
  label?: string;
  className?: string;
}) {
  return (
    <main className={`mx-auto min-h-[calc(100dvh-var(--tfmc-header-h))] w-full px-6 ${className}`}>
      <LoadingSkeleton variant={variant} label={label} />
    </main>
  );
}

export function MapSkeleton({ label = "Loading map…" }: { label?: string }) {
  return (
    <LoadingSkeleton variant="map" label={label} className="h-[calc(100dvh-var(--tfmc-header-h))] min-h-[28rem]" />
  );
}

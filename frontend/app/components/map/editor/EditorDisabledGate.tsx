import Link from "next/link";

export default function EditorDisabledGate() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)] px-6">
      <div className="max-w-lg text-center">
        <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-medium text-[var(--tfmc-cream)]">
          Map editor unavailable
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--tfmc-stone)]">
          Title editing is temporarily disabled while we finish the new export
          workflow. Map viewing is unchanged.
        </p>
        <Link
          href="/map"
          className="mt-6 inline-flex rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_40%,var(--tfmc-forest-deep))] px-4 py-2 text-sm font-medium text-[var(--tfmc-cream)] transition-colors hover:text-white"
        >
          Back to map
        </Link>
      </div>
    </div>
  );
}

import Link from "next/link";

export default function EditorEntryGate() {
  return (
    <div className="flex min-h-[calc(100dvh-var(--tfmc-header-h))] items-center justify-center bg-[var(--tfmc-forest-deep)] px-6">
      <div className="max-w-lg text-center">
        <h1 className="font-[family-name:var(--font-fraunces)] text-2xl font-medium text-[var(--tfmc-cream)]">
          Open the editor from the map page
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-[var(--tfmc-stone)]">
          Use <strong className="text-[var(--tfmc-cream)]">Edit titles</strong> on
          the map you want to change, or open Adavaar from the Map link.
        </p>
        <Link
          href="/map"
          className="mt-6 inline-flex rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_40%,var(--tfmc-forest-deep))] px-4 py-2 text-sm font-medium text-[var(--tfmc-cream)] transition-colors hover:text-white"
        >
          Go to map
        </Link>
      </div>
    </div>
  );
}

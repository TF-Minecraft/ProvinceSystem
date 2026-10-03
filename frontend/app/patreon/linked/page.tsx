import Link from "next/link";
import { getPatreonLinkedResult } from "../../../lib/profile/patreonLinked";

type SearchParams = {
  status?: string | string[];
  tier?: string | string[];
};

function singleValue(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

export default async function PatreonLinkedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const result = getPatreonLinkedResult(
    singleValue(params.status),
    singleValue(params.tier)
  );

  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl flex-col justify-center px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--tfmc-moss) 35%, transparent), transparent 65%)",
        }}
      />
      <section className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-6">
        <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">
          {result.title}
        </h1>
        <p className="mt-3 text-sm text-[var(--tfmc-mist)]">{result.message}</p>
        <Link
          href="/profile"
          className="mt-6 inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)]"
        >
          Go to profile
        </Link>
      </section>
    </main>
  );
}

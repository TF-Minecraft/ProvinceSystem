import Link from "next/link";

import BackToGateButton from "./components/site/BackToGateButton";

export default function HubPage() {
  return (
    <main className="relative flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center overflow-hidden px-6">
      {/* Atmosphere */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 50% 35%, color-mix(in srgb, var(--tfmc-moss) 55%, transparent), transparent 70%),
            radial-gradient(ellipse 100% 80% at 50% 100%, color-mix(in srgb, var(--tfmc-forest) 80%, #000), transparent),
            linear-gradient(165deg, var(--tfmc-forest-deep) 0%, var(--tfmc-forest) 45%, #152820 100%)
          `,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative z-10 flex max-w-2xl flex-col items-center text-center">
        <h1 className="hub-rise font-[family-name:var(--font-fraunces)] text-6xl font-medium tracking-tight text-[var(--tfmc-cream)] sm:text-7xl md:text-8xl">
          TFMC
        </h1>
        <p className="hub-rise-delay mt-4 max-w-md text-lg text-[var(--tfmc-mist)] sm:text-xl">
          Maps, donator skins, drinks, and characters for TFMC.
        </p>
        <div className="hub-fade-delay mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/map/main"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-forest-deep)] transition-transform hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Map
          </Link>
          <Link
            href="/skins"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Skins
          </Link>
          <Link
            href="/drinks"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Drinks
          </Link>
          <Link
            href="/profile"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Profile
          </Link>
          <Link
            href="/updates"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Updates
          </Link>
          <a
            href="http://patreon.com/c/tfmcrp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Support us on Patreon
          </a>
          <BackToGateButton />
        </div>
      </div>
    </main>
  );
}

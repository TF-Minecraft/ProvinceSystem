import Link from "next/link";

import BackToGateButton from "./components/site/BackToGateButton";
import HubAtmosphere, { hubOutlineButtonClass } from "./components/site/HubAtmosphere";

export default function HubPage() {
  return (
    <main className="relative flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center overflow-hidden px-6">
      <HubAtmosphere />

      <div className="relative z-10 flex max-w-2xl flex-col items-center text-center">
        <h1 className="animate-hub-rise">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-512.webp"
            alt="TFMC"
            width={256}
            height={256}
            className="block h-40 w-40 sm:h-52 sm:w-52 md:h-64 md:w-64"
          />
        </h1>
        <p className="animate-hub-rise-delay mt-4 max-w-md text-lg text-[var(--tfmc-mist)] sm:text-xl">
          Maps, donator skins, drinks, and characters for TFMC.
        </p>
        <div className="animate-hub-fade-delay mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/map"
            className="inline-flex min-w-[8.5rem] items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-forest-deep)] transition-transform hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            Map
          </Link>
          <Link
            href="/skins"
            className={hubOutlineButtonClass}
          >
            Skins
          </Link>
          <Link
            href="/drinks"
            className={hubOutlineButtonClass}
          >
            Drinks
          </Link>
          <Link
            href="/profile"
            className={hubOutlineButtonClass}
          >
            Profile
          </Link>
          <Link
            href="/updates"
            className={hubOutlineButtonClass}
          >
            Updates
          </Link>
          <a
            href="https://www.patreon.com/c/tfmcrp"
            target="_blank"
            rel="noopener noreferrer"
            className={hubOutlineButtonClass}
          >
            Support us on Patreon
          </a>
          <BackToGateButton />
        </div>
      </div>
    </main>
  );
}

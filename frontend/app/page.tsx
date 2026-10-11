import Link from "next/link";

import BackToGateButton from "./components/site/BackToGateButton";
import HubAtmosphere from "./components/site/HubAtmosphere";
import JoinServer from "./components/site/JoinServer";

type Destination = { href: string; label: string; blurb: string; icon: keyof typeof icons; featured?: boolean };

const destinations: Destination[] = [
  { href: "/map", label: "Map", blurb: "Nations, settlements and wars across the world.", icon: "map", featured: true },
  { href: "/wiki", label: "Guide", blurb: "Crafting, recipes and mechanics for Season 5.", icon: "guide" },
  { href: "/updates", label: "Updates", blurb: "What changed on the server each week.", icon: "updates" },
  { href: "/profile", label: "Profile", blurb: "Your characters, wardrobe and linked accounts.", icon: "profile" },
  { href: "/skins", label: "Skins", blurb: "Design a custom skin with a skin code.", icon: "skins" },
  { href: "/drinks", label: "Drinks", blurb: "Design a custom drink with a drink code.", icon: "drinks" },
];

const icons = {
  map: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z M9 4v14 M15 6v14",
  guide: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5 M8 7h8",
  updates: "M4 5h12v14H6.5A2.5 2.5 0 0 1 4 16.5V5Z M16 9h4v7.5a2.5 2.5 0 0 1-5 0 M7.5 9h5 M7.5 12.5h5 M7.5 16h3",
  profile: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4.5 21a7.5 7.5 0 0 1 15 0",
  skins: "M19 3.5 20.5 5 11 14.5 9.5 13 19 3.5Z M9.5 13C7 13 5 14.5 5 17c0 1.5-.8 2.7-2 3.5h5.5c3 0 4.5-2 4.5-4.5",
  drinks: "M9.5 3h5 M10.5 3v5L6.3 15.4A3.7 3.7 0 0 0 9.5 21h5a3.7 3.7 0 0 0 3.2-5.6L13.5 8V3 M7.5 14.5h9",
} as const;

function Icon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={icons[name]} />
    </svg>
  );
}

const cardClass =
  "group flex items-start gap-4 rounded-md border p-4 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]";

const cardTone = {
  featured:
    "border-[color-mix(in_srgb,var(--tfmc-accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_16%,transparent)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_24%,transparent)]",
  plain:
    "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] hover:border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]",
};

export default function HubPage() {
  return (
    <main className="relative flex min-h-[calc(100dvh-var(--tfmc-header-h))] flex-col items-center justify-center overflow-hidden px-6 py-12">
      <HubAtmosphere />

      <div className="relative z-10 flex w-full max-w-4xl flex-col items-center text-center">
        <h1 className="animate-hub-rise">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-512.webp"
            alt="TFMC"
            width={256}
            height={256}
            className="block h-32 w-32 drop-shadow-[0_12px_30px_rgb(0_0_0/0.45)] sm:h-40 sm:w-40 md:h-44 md:w-44"
          />
        </h1>

        <div className="animate-hub-rise-delay mt-6">
          <JoinServer />
        </div>

        <nav aria-label="Site" className="animate-hub-fade-delay mt-10 grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${cardClass} ${item.featured ? cardTone.featured : cardTone.plain}`}
            >
              <span
                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                  item.featured
                    ? "bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)]"
                    : "bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] text-[var(--tfmc-stone)]"
                }`}
              >
                <Icon name={item.icon} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2 font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
                  {item.label}
                  <span
                    aria-hidden
                    className="text-base text-[var(--tfmc-mist)] transition-transform group-hover:translate-x-0.5"
                  >
                    →
                  </span>
                </span>
                <span className="mt-0.5 block text-sm text-[var(--tfmc-mist)]">{item.blurb}</span>
              </span>
            </Link>
          ))}
        </nav>

        <div className="animate-hub-fade-delay mt-8 flex flex-wrap items-center justify-center gap-4">
          <a
            href="https://www.patreon.com/c/tfmcrp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-[var(--tfmc-mist)] transition-colors hover:text-[var(--tfmc-cream)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/patreon-symbol-white.svg"
              alt=""
              width={14}
              height={14}
              className="h-3.5 w-3.5 opacity-70"
            />
            Support us on Patreon
          </a>
          <BackToGateButton />
        </div>
      </div>
    </main>
  );
}

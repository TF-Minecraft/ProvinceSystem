"use client";

import Link from "next/link";

import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";

const staticLinks = [
  { href: "/", label: "Home" },
  { href: "/map/main", label: "Map" },
  { href: "/skins", label: "Skins" },
  { href: "/drinks", label: "Drinks" },
  { href: "/profile", label: "Profile" },
  { href: "/wiki", label: "Guide" },
  { href: "/updates", label: "Updates" },
] as const;

export default function SiteHeader() {
  const { state } = useSiteStaffAccess({ enabled: true });
  const isStaff = state === "staff";

  return (
    <header
      className="sticky top-0 z-[100] flex h-14 items-center border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_92%,transparent)] px-4 backdrop-blur-md sm:px-6"
      style={{ height: "var(--tfmc-header-h)" }}
    >
      <Link
        href="/"
        className="mr-4 shrink-0 font-[family-name:var(--font-fraunces)] text-lg tracking-wide text-[var(--tfmc-cream)] transition-opacity hover:opacity-80"
      >
        TFMC
      </Link>
      <nav
        className="ml-auto flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap [scrollbar-width:none] min-[400px]:gap-5 sm:gap-8 [&::-webkit-scrollbar]:hidden"
        aria-label="Main"
      >
        {staticLinks.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            // The logo already links home, so this link only shows once there is room for it.
            className={`text-sm font-medium text-[var(--tfmc-stone)] transition-colors hover:text-[var(--tfmc-cream)] ${href === "/" ? "hidden sm:inline" : ""}`}
          >
            {label}
          </Link>
        ))}
        {isStaff ? (
          <>
            <Link
              href="/precedent"
              className="text-sm font-medium text-[var(--tfmc-stone)] transition-colors hover:text-[var(--tfmc-cream)]"
            >
              Precedent
            </Link>
            <Link
              href="/inspect"
              className="text-sm font-medium text-[var(--tfmc-stone)] transition-colors hover:text-[var(--tfmc-cream)]"
            >
              Inspect
            </Link>
          </>
        ) : null}
      </nav>
    </header>
  );
}

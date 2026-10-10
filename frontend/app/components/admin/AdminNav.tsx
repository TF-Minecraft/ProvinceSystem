"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const LINKS = [
  { href: "/admin", label: "Accounts", key: "accounts" },
  { href: "/admin/players", label: "Players", key: "players" },
  { href: "/admin/movement", label: "Movement", key: "movement" },
  { href: "/admin/rail", label: "Rail", key: "rail" },
  { href: "/admin/ranks", label: "Ranks", key: "ranks" },
  { href: "/admin/precedent", label: "Precedent", key: "precedent" },
  { href: "/admin/codes", label: "Codes", key: "codes" },
] as const;

export type AdminSection = (typeof LINKS)[number]["key"];

/** The tab a staff path sits under: the deepest link that is the path or one of its parents. */
export function adminSection(pathname: string): AdminSection | null {
  let match: (typeof LINKS)[number] | null = null;
  for (const link of LINKS) {
    const under = pathname === link.href || pathname.startsWith(`${link.href}/`);
    if (under && (!match || link.href.length > match.href.length)) match = link;
  }
  return match?.key ?? null;
}

/** Rendered once by the staff layout, so it stays mounted and in place as the tabs change. */
export default function AdminNav() {
  const current = adminSection(usePathname() ?? "");
  const navRef = useRef<HTMLElement>(null);

  // On phones the tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current]);

  return (
    // Sits 1px low so the current tab's underline covers the row's border inside the scroll box.
    <nav
      ref={navRef}
      aria-label="Staff panel"
      className="-mb-px flex max-w-full gap-4 overflow-x-auto [scrollbar-width:none] sm:gap-5"
    >
      {LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={link.key === current ? "page" : undefined}
          className={`shrink-0 border-b-2 pb-2 text-sm font-semibold transition-colors ${
            link.key === current
              ? "border-[var(--tfmc-accent)] text-[var(--tfmc-cream)]"
              : "border-transparent text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

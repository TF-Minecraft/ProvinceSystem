"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Accounts", key: "accounts" },
  { href: "/admin/players", label: "Players", key: "players" },
  { href: "/admin/movement", label: "Movement", key: "movement" },
  { href: "/admin/rail", label: "Rail", key: "rail" },
  { href: "/admin/ranks", label: "Ranks", key: "ranks" },
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
  return (
    <nav aria-label="Staff panel" className="flex gap-4 sm:gap-5">
      {LINKS.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={link.key === current ? "page" : undefined}
          className={`-mb-px border-b-2 pb-2 text-sm font-semibold transition-colors ${
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

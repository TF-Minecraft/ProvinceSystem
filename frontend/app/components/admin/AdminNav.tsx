"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getAdminMe } from "@/lib/admin/api";

const LINKS = [
  { href: "/admin", label: "Accounts", key: "accounts" },
  { href: "/admin/players", label: "Players", key: "players" },
  { href: "/admin/movement", label: "Movement", key: "movement" },
  { href: "/admin/rail", label: "Rail", key: "rail" },
  { href: "/admin/ranks", label: "Ranks", key: "ranks" },
  { href: "/admin/commands", label: "Commands", key: "commands" },
  { href: "/admin/precedent", label: "Precedent", key: "precedent" },
  { href: "/admin/codes", label: "Codes", key: "codes" },
  { href: "/admin/servers", label: "Servers", key: "servers" },
  { href: "/admin/diagnostics", label: "Diagnostics", key: "diagnostics" },
  { href: "/admin/database", label: "Database", key: "database" },
] as const;

// Tabs only some roles can use stay hidden from the rest.
const CAPABILITY: Partial<Record<(typeof LINKS)[number]["key"], string>> = { database: "use_database" };

export type AdminSection = (typeof LINKS)[number]["key"];

/** The tab a staff path sits under: the deepest link that is the path or one of its parents. */
export function adminSection(pathname: string): AdminSection | null {
  if (pathname.startsWith("/admin/people/")) return "players";
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
  const [capabilities, setCapabilities] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    getAdminMe()
      .then((me) => live && setCapabilities(me.capabilities))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // On phones the tabs scroll sideways; keep the current one in view.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [current]);

  return (
    // Sits 1px low so the current tab's underline covers the row's border inside the scroll box.
    // Not selectable, so quick clicks between tabs don't highlight their labels.
    <nav
      ref={navRef}
      aria-label="Staff panel"
      className="-mb-px flex max-w-full select-none gap-4 overflow-x-auto [scrollbar-width:none] sm:gap-5"
    >
      {LINKS.filter((link) => !CAPABILITY[link.key] || capabilities.includes(CAPABILITY[link.key]!)).map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={link.key === current ? "page" : undefined}
          className={`shrink-0 border-b-2 pb-2 text-sm font-semibold outline-none transition-colors focus-visible:text-[var(--tfmc-accent)] ${
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

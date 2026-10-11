import type { ReactNode } from "react";
import Link from "next/link";

import { getWikiItemLinkTargets, resolveWikiItemHref } from "@/app/wiki/data/items";
import { stations } from "@/app/wiki/data/stations";

export interface WikiItemLinkProps {
  name: string;
  sourceId?: string;
  children?: ReactNode;
  className?: string;
}

export interface WikiItemTextProps {
  text: string;
  excludeHref?: string;
}

const proseTargets = new Map<string, string>();
for (const { name, href } of getWikiItemLinkTargets()) {
  proseTargets.set(name.toLocaleLowerCase(), href);
  if (!name.endsWith("s") && !proseTargets.has(`${name}s`.toLocaleLowerCase())) {
    proseTargets.set(`${name}s`.toLocaleLowerCase(), href);
  }
}
for (const station of stations) {
  const href = `/wiki/stations/${station.slug}`;
  proseTargets.set(station.name.toLocaleLowerCase(), href);
  if (!station.name.endsWith("s")) proseTargets.set(`${station.name}s`.toLocaleLowerCase(), href);
}
proseTargets.set("weapon station", "/wiki/stations/weapon-station");
proseTargets.set("weapon stations", "/wiki/stations/weapon-station");
const prosePattern = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...proseTargets.keys()]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

/** Link an exact custom item/material mention when it has one unambiguous wiki page. */
export default function WikiItemLink({ name, sourceId, children = name, className }: WikiItemLinkProps) {
  const href = resolveWikiItemHref(name, sourceId);
  if (!href) return <>{children}</>;

  return (
    <Link
      href={href}
      className={className ?? "underline decoration-dotted underline-offset-2 hover:text-[var(--tfmc-accent)]"}
    >
      {children}
    </Link>
  );
}

/** Add item links inside an explicitly supplied plain-text prose field. */
export function WikiItemText({ text, excludeHref }: WikiItemTextProps) {
  const parts = text.split(prosePattern);
  return parts.map((part, index) => {
    const href = proseTargets.get(part.toLocaleLowerCase());
    if (!href || href === excludeHref) return part;
    return (
      <Link
        key={`${index}-${part}`}
        href={href}
        className="underline decoration-dotted underline-offset-2 hover:text-[var(--tfmc-accent)]"
      >
        {part}
      </Link>
    );
  });
}

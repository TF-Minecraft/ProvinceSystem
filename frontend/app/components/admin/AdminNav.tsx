import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Accounts", key: "accounts" },
  { href: "/admin/players", label: "Players", key: "players" },
  { href: "/admin/movement", label: "Movement", key: "movement" },
] as const;

export default function AdminNav({ current }: { current: (typeof LINKS)[number]["key"] }) {
  return (
    <nav aria-label="Staff panel" className="mt-4 flex gap-5 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]">
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

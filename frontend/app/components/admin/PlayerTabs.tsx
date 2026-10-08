import Link from "next/link";

export type PlayerTab = "activity" | "sessions" | "movement" | "characters" | "discord";

const TABS: { tab: PlayerTab; label: string }[] = [
  { tab: "activity", label: "Activity" },
  { tab: "sessions", label: "Sessions" },
  { tab: "movement", label: "Movement" },
  { tab: "characters", label: "Characters" },
  { tab: "discord", label: "Discord" },
];

/** The profile's tabs, `?tab=` on the profile; Activity when absent or unknown. Movement is its own page. */
export function profileTab(value: string | null): Exclude<PlayerTab, "movement"> {
  return TABS.some((t) => t.tab === value) && value !== "movement" ? (value as Exclude<PlayerTab, "movement">) : "activity";
}

function href(uuid: string, tab: PlayerTab): string {
  const base = `/admin/players/${encodeURIComponent(uuid)}`;
  if (tab === "movement") return `${base}/movement`;
  return tab === "activity" ? base : `${base}?tab=${tab}`;
}

/** A player's sections, shared by the profile and the movement page. Movement only for those who may see it. */
export default function PlayerTabs({ uuid, current, movement }: { uuid: string; current: PlayerTab; movement: boolean }) {
  return (
    <nav
      aria-label="Player"
      className="scroll-strip mt-5 flex gap-1 overflow-x-auto border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]"
    >
      {TABS.filter((t) => movement || t.tab !== "movement").map(({ tab, label }) => {
        const active = tab === current;
        return (
          <Link
            key={tab}
            href={href(uuid, tab)}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)] ${
              active
                ? "border-[var(--tfmc-accent)] font-semibold text-[var(--tfmc-cream)]"
                : "border-transparent text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

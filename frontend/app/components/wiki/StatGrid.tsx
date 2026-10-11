import type { ReactNode } from "react";

import { cx, wikiHairline } from "./wikiStyles";

export interface StatGridItem {
  /** What the number is: "Cooldown", "Range", "Drop rate". */
  label: ReactNode;
  /** The number itself, with its unit: "3 seconds", "64 blocks", "12%". */
  value: ReactNode;
  /** Optional qualifier under the value: "shared with /recall", "per 12h". */
  note?: ReactNode;
}

export interface StatGridProps {
  stats: StatGridItem[];
  /** Columns at `sm` and up. One column on phones regardless. Defaults to 3. */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLUMNS: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 md:grid-cols-3",
  4: "sm:grid-cols-2 md:grid-cols-4",
};

/**
 * The "numbers that matter" block: cooldowns, costs, durations, drop rates, as a
 * compact definition list. Use it instead of burying a cooldown in a paragraph.
 */
export default function StatGrid({ stats, columns = 3, className }: StatGridProps) {
  return (
    <dl className={cx("mt-4 grid grid-cols-1 gap-3", COLUMNS[columns], className)}>
      {stats.map((stat, i) => (
        <div
          key={i}
          className={cx("rounded-md p-3", wikiHairline, "bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,transparent)]")}
        >
          <dt className="text-[11px] uppercase tracking-wide text-[var(--tfmc-stone)]">{stat.label}</dt>
          <dd className="mt-1 text-base text-[var(--tfmc-cream)]">
            {stat.value}
            {stat.note ? <span className="mt-0.5 block text-xs text-[var(--tfmc-mist)]">{stat.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

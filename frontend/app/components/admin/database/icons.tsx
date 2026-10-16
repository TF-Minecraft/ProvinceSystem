import type { ReactNode } from "react";

/** Line icons for the database studio, drawn rather than typed so no platform turns them into emoji. */
function Icon({ children, className = "h-3.5 w-3.5" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  );
}

type Props = { className?: string };

export const PlayIcon = ({ className = "h-3 w-3" }: Props) => (
  <svg aria-hidden viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`}>
    <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />
  </svg>
);

export const TableIcon = (p: Props) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 10h18M3 15h18M9 10v10" />
  </Icon>
);

export const ViewIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const QueryIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m5 8 4 4-4 4M12 16h7" />
  </Icon>
);

export const RefreshIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
    <path d="M4 3v5h5M4 13a8 8 0 0 0 14.6 4.5L20 16" />
    <path d="M20 21v-5h-5" />
  </Icon>
);

export const CloseIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const ChevronRightIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const ChevronLeftIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m15 6-6 6 6 6" />
  </Icon>
);

export const PlusIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const ArrowUpIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Icon>
);

export const ArrowDownIcon = (p: Props) => (
  <Icon {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Icon>
);

export const SortIcon = (p: Props) => (
  <Icon {...p}>
    <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
  </Icon>
);

/** The arrow for a column's current sort, or the two-way mark when it isn't sorted. */
export function SortMark({ direction, idle = false }: { direction: "asc" | "desc" | null; idle?: boolean }) {
  if (direction === "asc") return <ArrowUpIcon className="h-3 w-3 text-[var(--tfmc-accent)]" />;
  if (direction === "desc") return <ArrowDownIcon className="h-3 w-3 text-[var(--tfmc-accent)]" />;
  return idle ? <SortIcon className="h-3 w-3 opacity-50" /> : null;
}

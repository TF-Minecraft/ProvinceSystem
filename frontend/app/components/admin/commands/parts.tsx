import Link from "next/link";
import { Fragment } from "react";
import {
  commandLabel,
  commandState,
  groupLabel,
  type CommandGroup,
  type CommandPlugin,
  type CommandState,
  type RegisteredCommand,
} from "@/lib/admin/commands";
import { chipClass, panelClass, quietButtonClass } from "../ui";

export const commandPanelClass = `${panelClass} !mt-0 !p-0 overflow-hidden`;
export const lineClass = "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)]";
export const focusClass =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)]";
export const footnote = "Allowed by command permission. Plugins may apply further checks.";
export const stateLabels = { y: "Allowed", n: "Hidden", o: "No permission set" };
const stateDescriptions = {
  y: "Allowed by command permission",
  n: "Hidden from tab-complete",
  o: "No permission set; plugin decides when run",
};

export function Icon({ kind, className = "" }: { kind: "search" | "matrix" | "roles" | "arrow"; className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {kind === "search" ? (
        <>
          <circle cx="6.7" cy="6.7" r="4.5" />
          <path d="m10 10 3.7 3.7" />
        </>
      ) : kind === "matrix" ? (
        <>
          <rect x="1.5" y="2" width="13" height="12" rx="1" />
          <path d="M2 6h12M6 2v12M10 6v8" />
        </>
      ) : kind === "roles" ? (
        <>
          <circle cx="6" cy="5" r="2.5" />
          <path d="M1.5 14v-1.5a4.5 4.5 0 0 1 9 0V14M11 3a2.5 2.5 0 0 1 0 5M13 10a4 4 0 0 1 1.5 3v1" />
        </>
      ) : (
        <path d="M3 8h10m-4-4 4 4-4 4" />
      )}
    </svg>
  );
}

export function Caret({ open = false }: { open?: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
      className={`shrink-0 text-[var(--tfmc-mist)] ${open ? "rotate-90" : ""}`}
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function StateMark({ state }: { state: CommandState }) {
  return (
    <span
      role="img"
      aria-label={stateDescriptions[state]}
      title={stateDescriptions[state]}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center ${state === "y" ? "text-[#a0bb91]" : state === "o" ? "text-[#e8c48a]" : "text-[#6f8174]"}`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {state === "y" ? (
          <path d="m3.5 8 3 3 6-6" />
        ) : state === "o" ? (
          <circle cx="8" cy="8" r="4.2" />
        ) : (
          <path d="M5 8h6" />
        )}
      </svg>
    </span>
  );
}

export function Legend() {
  return (
    <div
      aria-label="Permission states"
      className="flex flex-wrap items-center gap-4 text-[11px] text-[var(--tfmc-mist)]"
    >
      {(["y", "n", "o"] as const).map((state) => (
        <span key={state} className="inline-flex items-center gap-1">
          <StateMark state={state} />
          {stateLabels[state]}
        </span>
      ))}
    </div>
  );
}

export function NewBadge({ children }: { children: React.ReactNode }) {
  return <span className={`${chipClass} !px-1 !py-0 !text-[10px] !text-[#a0bb91]`}>{children}</span>;
}

export function EmptyResults({ onReset }: { onReset: () => void }) {
  return (
    <div className="px-4 py-14 text-center text-[var(--tfmc-mist)]">
      <Icon kind="search" className="mx-auto mb-3 text-[var(--tfmc-accent)]" />
      <h3 className="text-base text-[var(--tfmc-cream)]">No commands found</h3>
      <p className="mt-1 text-sm">No commands match these filters.</p>
      <button type="button" className={`${quietButtonClass} ${focusClass} mt-4 min-h-9`} onClick={onReset}>
        Clear filters
      </button>
    </div>
  );
}

export function GroupLink({ group, className = "" }: { group: CommandGroup; className?: string }) {
  return (
    <Link
      href={`/admin/ranks/groups/${encodeURIComponent(group.name)}`}
      className={`${focusClass} hover:text-[var(--tfmc-accent)] ${className}`}
    >
      {groupLabel(group)}
    </Link>
  );
}

export function CommandDetail({
  command,
  plugin,
  groups,
}: {
  command: RegisteredCommand;
  plugin: CommandPlugin;
  groups: CommandGroup[];
}) {
  const allowed = groups.filter((_, index) => commandState(command, index) === "y");
  const fields: [string, React.ReactNode][] = [
    ["Permission", command.permission ? <code key="permission">{command.permission}</code> : "No permission set"],
    ...(command.shadowed
      ? [
          [
            "Command",
            <code key="label" className="text-[var(--tfmc-mist)]">
              {commandLabel(command, plugin)}
            </code>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(command.usage ? [["Usage", <code key="usage">{command.usage}</code>] as [string, React.ReactNode]] : []),
    ...(command.aliases.length
      ? [
          [
            "Aliases",
            <span key="aliases" className="flex flex-wrap gap-x-3 gap-y-1">
              {command.aliases.map((alias) => (
                <code key={alias}>/{alias}</code>
              ))}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    [
      "Allowed for",
      command.access === null
        ? "Up to the plugin"
        : allowed.length === groups.length
          ? "All roles"
          : allowed.map(groupLabel).join(", ") || "No listed roles",
    ],
    [
      "Plugin",
      <span key="plugin">
        {plugin.name} <span className="text-[var(--tfmc-mist)]">{plugin.version}</span>
      </span>,
    ],
  ];
  return (
    <div className="max-w-[calc(100vw-34px)] border-l-2 border-[var(--tfmc-accent)] bg-[var(--tfmc-forest)] px-4 py-4 text-left text-xs sm:max-w-none sm:pl-8">
      <p className="mb-3 text-[var(--tfmc-stone)]">{command.description || "No description supplied."}</p>
      <dl className="grid grid-cols-[65px_minmax(0,1fr)] gap-x-4 gap-y-2 sm:grid-cols-[86px_minmax(0,1fr)]">
        {fields.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-[var(--tfmc-mist)]">{label}</dt>
            <dd className="min-w-0 break-words [overflow-wrap:anywhere] [&_code]:text-[11px]">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

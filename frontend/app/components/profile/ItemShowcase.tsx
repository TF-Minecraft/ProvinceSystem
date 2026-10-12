"use client";

import type { ReactNode } from "react";
import FormattedMcRuns from "../shared/FormattedMcRuns";
import { parseLoreRuns, type LoreRun } from "../../../lib/characters/lorePreview";
import { STATUS_CHIPS } from "./Wardrobe";

/** One skin, drink or custom item: the picture on a stage, and what it is beside it. */
export function Showcase({
  stage,
  controls,
  children,
}: {
  stage: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-8">
      <div className="min-w-0">
        <div className="relative h-[clamp(18rem,62vw,26rem)] overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[radial-gradient(circle_at_50%_42%,var(--tfmc-moss),color-mix(in_srgb,var(--tfmc-forest-deep)_92%,var(--tfmc-forest))_72%)]">
          {stage}
        </div>
        {controls ? <div className="mt-3 space-y-3">{controls}</div> : null}
      </div>
      <div className="min-w-0 space-y-6">{children}</div>
    </div>
  );
}

/** A picture centred on the stage, scaled up without smoothing. */
export function StagePicture({ children }: { children: ReactNode }) {
  return <div className="absolute inset-0 grid place-items-center p-10">{children}</div>;
}

export function StageNote({ children }: { children: ReactNode }) {
  return (
    <p className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] text-[color-mix(in_srgb,var(--tfmc-cream)_45%,transparent)]">
      {children}
    </p>
  );
}

/** A row of choices under the stage: armour sets, book covers. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] p-0.5"
    >
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.id)}
            className={`rounded-sm px-3 py-1 text-sm transition-colors ${
              selected
                ? "bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] text-[var(--tfmc-cream)]"
                : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Inventory-style slots for flat item icons, labelled underneath. */
export function IconSlots({ icons }: { icons: { label: string; src: string | null }[] }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {icons.map((icon) => (
        <li key={icon.label} className="flex w-16 flex-col items-center gap-1">
          <span className="grid h-14 w-14 place-items-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_70%,transparent)]">
            {icon.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- object URLs
              <img src={icon.src} alt="" className="h-10 w-10 [image-rendering:pixelated]" />
            ) : null}
          </span>
          <span className="text-[11px] text-[var(--tfmc-mist)]">{icon.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function Heading({ title, detail }: { title: string; detail?: ReactNode }) {
  return (
    <div>
      <h2 className="font-[family-name:var(--font-fraunces)] text-3xl leading-tight break-words text-[var(--tfmc-cream)]">
        {title}
      </h2>
      {detail ? <p className="mt-1 text-sm text-[var(--tfmc-mist)]">{detail}</p> : null}
    </div>
  );
}

/** The name and lore as the item shows them in game. */
export function Tooltip({ name, lore = [] }: { name: LoreRun[]; lore?: string[] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">In game</p>
      <TooltipBox name={name} lore={lore} />
    </div>
  );
}

function TooltipBox({ name, lore }: { name: LoreRun[]; lore: string[] }) {
  return (
    <div className="inline-block max-w-full rounded-[3px] border-2 border-[#24063f] bg-[#100010f2] p-[3px] font-mono shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="rounded-[2px] border border-[#5000ff80] px-3 py-2 [border-bottom-color:#28007f80]">
        <p className="text-base leading-snug break-words">
          <FormattedMcRuns runs={name} />
        </p>
        {lore.length ? (
          <ul className="mt-1.5 space-y-0.5 text-[13px] leading-snug">
            {lore.map((line, i) => (
              <li key={`${i}-${line.slice(0, 12)}`} className="break-words">
                {line.trim() ? <FormattedMcRuns runs={parseLoreRuns(line)} /> : " "}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function plainName(text: string): LoreRun[] {
  return [{ text, color: "#ffffff" }];
}

/** The chip from the wardrobe card, then one plain sentence; a denial reason gets its own box. */
export function StatusBlock({
  status,
  message,
  reason,
  action,
}: {
  status: string;
  message: string;
  reason?: string | null;
  action?: ReactNode;
}) {
  const chip = STATUS_CHIPS[status.toLowerCase()];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {chip ? (
          <span
            className={`rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${chip.className}`}
          >
            {chip.label}
          </span>
        ) : null}
        <p className="text-[var(--tfmc-cream)]">{message}</p>
      </div>
      {reason ? (
        <p
          className="rounded-sm border border-[color-mix(in_srgb,#e8a0a0_35%,transparent)] bg-[color-mix(in_srgb,#e8a0a0_8%,transparent)] px-3 py-2 text-sm text-[#f0b8b8]"
          role="note"
        >
          {reason}
        </p>
      ) : null}
      {action}
    </div>
  );
}

export type Fact = { label: string; value: ReactNode };

export function Facts({ facts }: { facts: (Fact | null | false | undefined)[] }) {
  const shown = facts.filter((f): f is Fact => Boolean(f));
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2.5 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pt-5 text-sm">
      {shown.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="text-[var(--tfmc-stone)]">{fact.label}</dt>
          <dd className="min-w-0 text-[var(--tfmc-cream)]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", year: "numeric" });

/** "12 October 2026", or null for a missing or unreadable date. */
export function formatDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : DAY.format(date);
}

export const quietActionClass =
  "text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";

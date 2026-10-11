"use client";

import Link from "next/link";
import type { CharacterListItem, CreationCatalog } from "../../../lib/characters/api";
import { displayClass, displayRace } from "../../../lib/characters/displayNames";

type Props = {
  characters: CharacterListItem[];
  aliveCount: number;
  maxSlots: number;
  catalog?: CreationCatalog | null;
  onRefresh?: () => void;
  refreshing?: boolean;
};

const cardClass =
  "flex h-full min-h-[84px] items-center gap-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_50%,transparent)] p-3 pr-4";
const linkCardClass =
  "group transition-colors hover:border-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_4%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]";
const tileClass =
  "flex h-full min-h-[84px] items-center justify-center gap-3 rounded-sm border border-dashed border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] px-4 text-sm";
const chipClass = "rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider";

const CHIPS: Record<string, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-[#c8b27a] text-[var(--tfmc-forest-deep)]" },
  REJECTED: { label: "Rejected", className: "bg-[color-mix(in_srgb,#e8a0a0_22%,transparent)] text-[#f0b8b8]" },
  MISSING: {
    label: "Missing",
    className: "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] text-[var(--tfmc-stone)]",
  },
};

function statusOf(item: CharacterListItem): string {
  return String(item.status || "").toUpperCase();
}

/** The character's initial on the wardrobe cards' backdrop. */
function Crest({ name, faded }: { name: string; faded?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-14 w-14 shrink-0 place-items-center rounded-sm bg-[radial-gradient(circle_at_50%_45%,var(--tfmc-moss),color-mix(in_srgb,var(--tfmc-forest-deep)_90%,var(--tfmc-forest))_75%)] font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)] ${faded ? "opacity-50 grayscale" : ""}`}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Card({ item, catalog }: { item: CharacterListItem; catalog?: CreationCatalog | null }) {
  const status = statusOf(item);
  const name = item.name || "Unnamed";
  const meta = [displayRace(item, catalog), displayClass(item, catalog)].filter(Boolean).join(" · ");
  const err = String(item.error || "").trim();
  const chip = CHIPS[status];
  const linkable = Boolean(item.id) && (status === "ALIVE" || status === "PENDING");
  const faded = status === "DEAD" || status === "MISSING" || status === "REJECTED";
  const body = (
    <>
      <Crest name={name} faded={faded} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">{name}</p>
          {chip ? <span className={`${chipClass} ${chip.className}`}>{chip.label}</span> : null}
        </div>
        <p className="truncate text-sm text-[var(--tfmc-mist)]">{meta || "-"}</p>
        {status === "REJECTED" && err ? <p className="mt-0.5 text-xs text-[#e8a0a0]">{err}</p> : null}
      </div>
      {linkable ? (
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="h-4 w-4 shrink-0 text-[var(--tfmc-stone)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--tfmc-cream)]"
        >
          <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      ) : null}
    </>
  );
  return (
    <li className="animate-char-row">
      {linkable ? (
        <Link href={`/character/${encodeURIComponent(item.id)}`} className={`${cardClass} ${linkCardClass}`}>
          {body}
        </Link>
      ) : (
        <div className={`${cardClass} ${faded ? "text-[var(--tfmc-stone)]" : ""}`}>{body}</div>
      )}
    </li>
  );
}

function SlotPips({ used, total }: { used: number; total: number }) {
  if (total < 1 || total > 12) return null;
  return (
    <span aria-hidden className="flex gap-1">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-4 rounded-full ${i < used ? "bg-[var(--tfmc-accent)]" : "bg-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]"}`}
        />
      ))}
    </span>
  );
}

export default function CharacterList({
  characters,
  aliveCount,
  maxSlots,
  catalog = null,
  onRefresh,
  refreshing = false,
}: Props) {
  const order = ["ALIVE", "PENDING", "REJECTED"];
  const current = characters
    .filter((c) => order.includes(statusOf(c)))
    .sort((a, b) => order.indexOf(statusOf(a)) - order.indexOf(statusOf(b)));
  const dead = characters.filter((c) => statusOf(c) === "DEAD" || statusOf(c) === "MISSING");
  const hasPending = current.some((c) => statusOf(c) === "PENDING");
  const atLimit = aliveCount >= maxSlots;

  return (
    <div className="animate-char-rise">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--tfmc-mist)]">
        <span className="flex items-center gap-3">
          <span>
            {aliveCount} of {maxSlots} {maxSlots === 1 ? "slot" : "slots"} used
          </span>
          <SlotPips used={aliveCount} total={maxSlots} />
        </span>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {current.map((c) => (
          <Card key={c.id} item={c} catalog={catalog} />
        ))}
        <li>
          {atLimit ? (
            <div className={`${tileClass} text-[var(--tfmc-stone)] opacity-70`} aria-disabled>
              No free slot
            </div>
          ) : (
            <Link
              href="/character/create"
              className={`${tileClass} text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-accent)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]`}
            >
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center rounded-full border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] text-lg leading-none"
              >
                +
              </span>
              New character
            </Link>
          )}
        </li>
      </ul>
      {hasPending ? (
        <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
          Pending characters take up to a minute. You can still edit kits and wardrobe.
        </p>
      ) : null}

      {dead.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">Dead</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {dead.map((c) => (
              <Card key={c.id} item={c} catalog={catalog} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

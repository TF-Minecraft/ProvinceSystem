"use client";

import Link from "next/link";
import type { CharacterListItem, CreationCatalog } from "../../../lib/characters/api";
import { displayClass, displayRace } from "../../../lib/characters/displayNames";

type Props = {
  characters: CharacterListItem[];
  aliveCount: number;
  maxSlots: number;
  catalog?: CreationCatalog | null;
  webCreatorAllowed?: boolean;
  webCreatorLockLabel?: string;
  onLogout: () => void;
  loggingOut?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
};

function Row({
  item,
  linkable,
  catalog,
}: {
  item: CharacterListItem;
  linkable?: boolean;
  catalog?: CreationCatalog | null;
}) {
  const status = String(item.status || "").toUpperCase();
  const meta = [displayRace(item, catalog), displayClass(item, catalog)]
    .filter(Boolean)
    .join(" · ");
  const err = String(item.error || "").trim();
  const body = (
    <>
      <div>
        <p className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
          {item.name || "Unnamed"}
        </p>
        <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
          {meta || "-"}
        </p>
        {status === "REJECTED" && err ? (
          <p className="mt-1 text-xs text-[#e8a0a0]">{err}</p>
        ) : null}
      </div>
      {/* Section headings name the status; only Missing needs a badge. */}
      {status === "MISSING" ? (
        <span className="text-xs font-medium text-[var(--tfmc-stone)]">
          Missing
        </span>
      ) : null}
    </>
  );
  if (linkable && item.id) {
    return (
      <li className="char-row border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] last:border-b-0">
        <Link
          href={`/character/${encodeURIComponent(item.id)}`}
          className="flex flex-col gap-1 py-4 transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_4%,transparent)] sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
        >
          {body}
        </Link>
      </li>
    );
  }
  return (
    <li className="char-row flex flex-col gap-1 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] py-4 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      {body}
    </li>
  );
}

function Section({
  title,
  items,
  empty,
  hint,
  linkAlive,
  catalog,
}: {
  title: string;
  items: CharacterListItem[];
  empty?: string;
  hint?: string;
  linkAlive?: boolean;
  catalog?: CreationCatalog | null;
}) {
  if (items.length === 0 && !empty) return null;
  return (
    <section className="mt-10">
      <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        {title}
      </h2>
      {hint ? (
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">{hint}</p>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--tfmc-mist)]">{empty}</p>
      ) : (
        <ul className="mt-2">
          {items.map((c) => (
            <Row
              key={c.id}
              item={c}
              catalog={catalog}
              linkable={
                linkAlive &&
                (String(c.status || "").toUpperCase() === "ALIVE" ||
                  String(c.status || "").toLowerCase() === "pending")
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export default function CharacterList({
  characters,
  aliveCount,
  maxSlots,
  catalog = null,
  webCreatorAllowed = true,
  webCreatorLockLabel = "",
  onLogout,
  loggingOut = false,
  onRefresh,
  refreshing = false,
}: Props) {
  const alive = characters.filter(
    (c) => String(c.status).toUpperCase() === "ALIVE"
  );
  const pending = characters.filter(
    (c) => String(c.status).toLowerCase() === "pending"
  );
  const rejected = characters.filter(
    (c) => String(c.status).toLowerCase() === "rejected"
  );
  const dead = characters.filter((c) => {
    const s = String(c.status).toUpperCase();
    return s === "DEAD" || s === "MISSING";
  });

  const atLimit = aliveCount >= maxSlots;
  const hasAny = characters.length > 0;
  const creatorLocked = !webCreatorAllowed;
  const lockLabel =
    webCreatorLockLabel.trim() ||
    "Not available for your rank yet.";

  return (
    <div className="char-rise mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--tfmc-stone)]">
          Alive characters {aliveCount}/{maxSlots}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {onRefresh ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing || loggingOut}
              className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
          {atLimit ? (
            <span className="text-sm text-[var(--tfmc-mist)]">
              No free slot
            </span>
          ) : creatorLocked ? (
            <span className="text-sm text-[var(--tfmc-mist)]">{lockLabel}</span>
          ) : (
            <Link
              href="/character/create"
              className="inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90"
            >
              Create
            </Link>
          )}
          <button
            type="button"
            onClick={onLogout}
            disabled={loggingOut}
            className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
          >
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </div>

      {!hasAny ? (
        <div className="mt-12 text-center">
          <p className="text-[var(--tfmc-mist)]">No characters yet.</p>
          {creatorLocked ? (
            <p className="mt-4 text-sm text-[var(--tfmc-stone)]">{lockLabel}</p>
          ) : !atLimit ? (
            <Link
              href="/character/create"
              className="mt-6 inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90"
            >
              Create a character
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <Section
            title="Alive"
            items={alive}
            empty="No alive characters."
            linkAlive
            catalog={catalog}
          />
          <Section
            title="Pending"
            items={pending}
            hint={
              pending.length > 0
                ? "This can take up to a minute. You can still edit kits and wardrobe."
                : undefined
            }
            linkAlive
            catalog={catalog}
          />
          <Section title="Rejected" items={rejected} catalog={catalog} />
          <Section title="Dead" items={dead} catalog={catalog} />
        </>
      )}
    </div>
  );
}

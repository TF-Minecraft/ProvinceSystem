"use client";

import Link from "next/link";
import type {
  CharacterListItem,
  CharacterSheetTrait,
  CreationCatalog,
  ExperienceModifierDto,
} from "../../../lib/characters/api";
import {
  displayClass,
  displayRace,
  traitSelectionGroupLabel,
} from "../../../lib/characters/displayNames";
import { formatFantasyBirthday } from "../../../lib/characters/fantasyCalendar";
import { displayAttrName } from "../../../lib/characters/pointBuy";

type Props = {
  character: CharacterListItem;
  catalog?: CreationCatalog | null;
  onCancelPending?: () => void | Promise<void>;
  cancelling?: boolean;
};

function capitalizeKey(raw: string): string {
  const s = raw.trim();
  if (!s) return "Other";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatTraitSuffix(t: CharacterSheetTrait): string {
  const parts: string[] = [];
  const ms = t.duration_remaining_ms;
  if (ms != null && Number.isFinite(ms) && ms > 0) {
    const hours = Math.floor(ms / 3_600_000);
    const mins = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0) {
      parts.push(`${hours}h remaining`);
    } else {
      parts.push(`${mins}m remaining`);
    }
  }
  const fuel = t.fuel_percent;
  if (fuel != null && Number.isFinite(fuel)) {
    parts.push(`Fuel: ${fuel}%`);
  }
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function groupTraits(
  traits: CharacterSheetTrait[]
): { key: string; label: string; items: CharacterSheetTrait[] }[] {
  const order: string[] = [];
  const map = new Map<string, CharacterSheetTrait[]>();
  for (const t of traits) {
    const key = String(t.key || "other").trim().toLowerCase() || "other";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(t);
  }
  return order.map((key) => ({
    key,
    label: traitSelectionGroupLabel(key),
    items: map.get(key) || [],
  }));
}

function formatXpAmount(amount: number): string {
  if (amount > 0) return `+${amount}%`;
  return `${amount}%`;
}

function SheetSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function CharacterSheet({
  character,
  catalog,
  onCancelPending,
  cancelling = false,
}: Props) {
  const status = String(character.status || "").toUpperCase();
  const isAlive = status === "ALIVE";
  const isPending = status === "PENDING";
  const canEditGear = isAlive || isPending;

  const race = displayRace(character, catalog);
  const klass = displayClass(character, catalog);
  const age = String(character.age || "").trim();
  const birthdayIso = String(character.birthday || "").trim();
  const birthday =
    formatFantasyBirthday(birthdayIso, catalog?.validation?.calendar) ||
    birthdayIso;
  const gender = String(character.gender || "").trim();
  const description = String(character.description || "").trim();
  const background = String(character.background || "").trim();

  const identityBits = [
    race || null,
    klass || null,
    age ? `Age ${age}` : null,
    birthday || null,
    gender || null,
  ].filter(Boolean) as string[];

  const attrs = character.attributes;
  const attrEntries =
    attrs && typeof attrs === "object"
      ? Object.entries(attrs)
          .map(([k, v]) => [String(k).trim(), Number(v)] as const)
          .filter(([k, v]) => k && Number.isFinite(v))
          .sort(([a], [b]) => a.localeCompare(b))
      : [];

  const xpMods: ExperienceModifierDto[] = Array.isArray(
    character.experience_modifiers
  )
    ? character.experience_modifiers.filter(
        (m) =>
          m &&
          String(m.profession || m.alias || "").trim() &&
          Number.isFinite(Number(m.amount))
      )
    : [];

  const traits = Array.isArray(character.traits)
    ? character.traits.filter((t) => t && String(t.name || t.id || "").trim())
    : [];
  const traitGroups = traits.length ? groupTraits(traits) : [];

  const clues = Array.isArray(character.clues)
    ? character.clues.map((c) => String(c).trim()).filter(Boolean)
    : [];

  return (
    <>
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">
        {character.name || "Unnamed"}
      </h1>
      {/* Alive needs no label; pending has PendingServerBanner. */}
      {status && !canEditGear ? (
        <p className="mt-2 text-xs font-medium text-[var(--tfmc-stone)]">
          {capitalizeKey(status.toLowerCase())}
        </p>
      ) : null}

      {identityBits.length > 0 ? (
        <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
          {identityBits.join(" · ")}
        </p>
      ) : null}

      {description ? (
        <SheetSection title="Description">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--tfmc-mist)]">
            {description}
          </p>
        </SheetSection>
      ) : null}

      {background ? (
        <SheetSection title="Background">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--tfmc-mist)]">
            {background}
          </p>
        </SheetSection>
      ) : null}

      {attrEntries.length > 0 ? (
        <SheetSection title="Attributes">
          <ul className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]">
            {attrEntries.map(([key, amount]) => (
              <li
                key={key}
                className="flex items-baseline justify-between gap-4 py-2 text-sm"
              >
                <span className="text-[var(--tfmc-cream)]">
                  {displayAttrName(key)}
                </span>
                <span className="text-[var(--tfmc-stone)]">{amount}</span>
              </li>
            ))}
          </ul>
        </SheetSection>
      ) : null}

      {xpMods.length > 0 ? (
        <SheetSection title="Profession EXP">
          <ul className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]">
            {xpMods.map((m) => {
              const label =
                String(m.alias || "").trim() ||
                capitalizeKey(String(m.profession || ""));
              const amount = Number(m.amount);
              return (
                <li
                  key={String(m.profession || label)}
                  className="flex items-baseline justify-between gap-4 py-2 text-sm"
                >
                  <span className="text-[var(--tfmc-cream)]">{label}</span>
                  <span className="text-[var(--tfmc-stone)]">
                    {formatXpAmount(amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </SheetSection>
      ) : null}

      {traitGroups.length > 0 ? (
        <SheetSection title="Traits">
          <div className="flex flex-col gap-6">
            {traitGroups.map((group) => (
              <div key={group.key}>
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
                  {group.label}
                </p>
                <ul className="mt-2 space-y-1">
                  {group.items.map((t) => {
                    const suffix = formatTraitSuffix(t);
                    return (
                    <li
                      key={t.id || t.name}
                      className="text-sm text-[var(--tfmc-mist)]"
                    >
                      {String(t.name || t.id).trim()}
                      {suffix ? (
                        <span className="text-[var(--tfmc-stone)]">{suffix}</span>
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </SheetSection>
      ) : null}

      {clues.length > 0 ? (
        <SheetSection title="Clues">
          <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
            {clues.map((clue, i) => (
              <li key={`${i}-${clue.slice(0, 24)}`}>{clue}</li>
            ))}
          </ul>
        </SheetSection>
      ) : null}

      {canEditGear ? (
        <nav className="mt-10 flex flex-col gap-3">
          <Link
            href={`/character/${encodeURIComponent(character.id)}/kits`}
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-4 py-3 text-[var(--tfmc-cream)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
          >
            Kits
          </Link>
          <Link
            href={`/character/${encodeURIComponent(character.id)}/wardrobe`}
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-4 py-3 text-[var(--tfmc-cream)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
          >
            Wardrobe
          </Link>
          {isPending && onCancelPending ? (
            <button
              type="button"
              disabled={cancelling}
              onClick={() => {
                if (
                  !window.confirm(
                    "Cancel this submission? The pending character, wardrobe drafts, and kit customisations will be removed. This cannot be undone."
                  )
                ) {
                  return;
                }
                void onCancelPending();
              }}
              className="rounded-sm border border-[color-mix(in_srgb,#e8a0a0_55%,transparent)] px-4 py-3 text-sm text-[#e8a0a0] transition-colors hover:bg-[color-mix(in_srgb,#e8a0a0_10%,transparent)] disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel submission"}
            </button>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}

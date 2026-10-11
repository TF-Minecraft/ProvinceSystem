"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode, type Ref } from "react";
import type {
  CharacterListItem,
  CharacterSheetTrait,
  CreationCatalog,
  ExperienceModifierDto,
} from "../../../lib/characters/api";
import { attributeCeilings } from "../../../lib/characters/attributeCeiling";
import { backgroundTraits, ORIGIN_KEYS } from "../../../lib/characters/background";
import { displayClass, displayRace, traitSelectionGroupLabel } from "../../../lib/characters/displayNames";
import { formatFantasyBirthday } from "../../../lib/characters/fantasyCalendar";
import { displayAttrName } from "../../../lib/characters/pointBuy";
import { paragraphs, splitStory } from "../../../lib/characters/story";
import CharacterFigure from "./CharacterFigure";

type Props = {
  character: CharacterListItem;
  catalog?: CreationCatalog | null;
  /** Reads the worn skin; null shows the player's head. */
  sessionToken?: string | null;
  playerUuid?: string | null;
  /** The name's heading, focused when the character opens. */
  headingRef?: Ref<HTMLHeadingElement>;
  onCancelPending?: () => void | Promise<void>;
  cancelling?: boolean;
};

/** Each attribute bar splits its ceiling into this many segments. */
const ATTRIBUTE_SEGMENTS = 5;

const ATTRIBUTE_ORDER = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

const labelClass = "text-xs font-bold uppercase tracking-[0.08em] text-[var(--tfmc-stone)]";
const sectionHeadingClass = "mb-3 font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]";
const panelClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)]";
const quietClass = "text-sm text-[var(--tfmc-mist)]";
const proseClass =
  "max-w-[65ch] whitespace-pre-line break-words text-base leading-[1.6] text-[color-mix(in_srgb,var(--tfmc-cream)_85%,var(--tfmc-mist))]";
const actionClass =
  "group flex min-h-14 min-w-0 items-center gap-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-cream)_3%,transparent)] px-3.5 py-2 text-[15px] font-semibold text-[var(--tfmc-cream)] transition-colors hover:border-[color-mix(in_srgb,var(--tfmc-cream)_45%,transparent)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_7%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function capitalizeKey(raw: string): string {
  const s = raw.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Other";
}

/** "1h remaining", "Fuel: 35%", or both; empty for a permanent trait. */
function timedNote(t: CharacterSheetTrait): string {
  const parts: string[] = [];
  const ms = t.duration_remaining_ms;
  if (ms != null && Number.isFinite(ms) && ms > 0) {
    const hours = Math.floor(ms / 3_600_000);
    parts.push(hours > 0 ? `${hours}h remaining` : `${Math.floor((ms % 3_600_000) / 60_000)}m remaining`);
  }
  if (t.fuel_percent != null && Number.isFinite(t.fuel_percent)) parts.push(`Fuel: ${t.fuel_percent}%`);
  return parts.join(", ");
}

type TraitTag = { key: string; name: string; description?: string };

/** Traits grouped by key, in the order creation asks for them. */
function groupTraits(tags: TraitTag[], catalog?: CreationCatalog | null) {
  const groups = new Map<string, TraitTag[]>();
  for (const t of tags) {
    const key = t.key || "other";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }
  const order = (catalog?.stages ?? []).map((s) => text(s.key).toLowerCase()).filter(Boolean);
  const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
  return [...groups]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, tags]) => ({ key, label: traitSelectionGroupLabel(key), tags }));
}

/** The catalogue's attributes in its order, then any others the character has. */
function attributeRows(attrs: Record<string, number> | null | undefined, catalog?: CreationCatalog | null) {
  const values = new Map<string, number>();
  for (const [k, v] of Object.entries(attrs && typeof attrs === "object" ? attrs : {})) {
    const key = text(k).toLowerCase();
    if (key && Number.isFinite(Number(v))) values.set(key, Number(v));
  }
  const known = catalog?.attribute_point_buy?.attributes?.map((a) => a.toLowerCase()) ?? ATTRIBUTE_ORDER;
  const keys = [...known.filter((k) => values.has(k)), ...[...values.keys()].filter((k) => !known.includes(k)).sort()];
  return keys.map((key) => ({ key, value: values.get(key)! }));
}

/** The Kits page's wording: legacy "ineligible" kits can still be claimed in-game. */
function starterKitLabel(status: string | null | undefined): string | null {
  const s = text(status).toLowerCase();
  if (s === "granted") return "Claimed";
  if (s === "eligible" || s === "ineligible") return "Not yet claimed";
  return null;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h3 className={sectionHeadingClass}>{title}</h3>
      {children}
    </section>
  );
}

function Prose({ text: body }: { text: string }) {
  return (
    <>
      {paragraphs(body).map((p, i) => (
        <p key={i} className={`${proseClass} mb-3`}>
          {p}
        </p>
      ))}
    </>
  );
}

function Background({ text: body }: { text: string }) {
  const [open, setOpen] = useState(false);
  const textId = useId();
  const split = splitStory(body);
  if (!split) return <Prose text={body} />;
  return (
    <>
      <div id={textId}>
        <Prose text={open ? body : split.lead} />
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={textId}
        onClick={() => setOpen((o) => !o)}
        className="min-h-11 text-sm font-semibold text-[var(--tfmc-accent)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-cream)]"
      >
        {open ? "Show less" : "Read full background"}
      </button>
    </>
  );
}

function Icon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden
      className="h-[18px] w-[18px] shrink-0 text-[var(--tfmc-accent)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

const HANGER =
  "M10 6.5a1.8 1.8 0 1 1 1.8-1.8c0 1-1.8 1.4-1.8 2.6M10 7.3 2.8 13a1 1 0 0 0 .6 1.8h13.2a1 1 0 0 0 .6-1.8L10 7.3Z";
const CHEVRON = "M7.5 4.5 13 10l-5.5 5.5";
const CHEST = "M3 7h14v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Zm4 0V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7M3 11h14";

/** A way into the wardrobe or kits, with what's there now. */
function ActionCard({ href, icon, title, note }: { href: string; icon: string; title: string; note: string | null }) {
  const noteId = useId();
  return (
    <Link href={href} className={actionClass} aria-describedby={note ? noteId : undefined}>
      <Icon path={icon} />
      <span className="min-w-0 flex-1">
        {title}
        {note ? (
          <span id={noteId} aria-hidden className="block break-words text-xs font-normal text-[var(--tfmc-mist)]">
            {note}
          </span>
        ) : null}
      </span>
      <svg
        viewBox="0 0 20 20"
        aria-hidden
        className="h-4 w-4 shrink-0 text-[var(--tfmc-stone)] transition-transform group-hover:translate-x-0.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={CHEVRON} />
      </svg>
    </Link>
  );
}

/** One character: who they are, their mechanics, traits, story and clues. */
export default function CharacterSheet({
  character,
  catalog,
  sessionToken = null,
  playerUuid = null,
  headingRef,
  onCancelPending,
  cancelling = false,
}: Props) {
  const isPending = text(character.status).toUpperCase() === "PENDING";
  const name = character.name || "Unnamed";
  const id = encodeURIComponent(character.id);

  const lineage = [displayRace(character, catalog), displayClass(character, catalog)].filter(Boolean).join(" · ");
  const birthdayIso = text(character.birthday);
  const facts = [
    ["Age", text(character.age)],
    ["Born", formatFantasyBirthday(birthdayIso, catalog?.validation?.calendar) || birthdayIso],
    ["Gender", text(character.gender)],
  ].filter(([, v]) => v);
  // A pending character can always claim its kits once it reaches the server.
  const wornNote =
    character.worn_skin === undefined ? null : character.worn_skin ? `Wearing ${character.worn_skin}` : "No skin yet";
  const kit = starterKitLabel(character.kit_status) ?? (isPending ? "Not yet claimed" : null);

  const attrs = attributeRows(character.attributes, catalog);
  const ceilings = useMemo(() => attributeCeilings(catalog), [catalog]);
  const xpMods: ExperienceModifierDto[] = Array.isArray(character.experience_modifiers)
    ? character.experience_modifiers.filter(
        (m) => m && text(m.profession || m.alias) && Number.isFinite(Number(m.amount)),
      )
    : [];
  const traits = Array.isArray(character.traits) ? character.traits.filter((t) => t && text(t.name || t.id)) : [];
  const timed = traits.filter((t) => timedNote(t));
  // The background arrives as the lore of the creation choices behind it.
  const chosen = backgroundTraits(text(character.background), catalog, character.race || character.race_name);
  const origins = chosen.traits
    .filter((t) => ORIGIN_KEYS.includes(t.key))
    .sort((a, b) => ORIGIN_KEYS.indexOf(a.key) - ORIGIN_KEYS.indexOf(b.key));
  const groups = groupTraits(
    [
      ...chosen.traits.filter((t) => !ORIGIN_KEYS.includes(t.key)),
      ...traits
        .filter((t) => !timedNote(t))
        .map((t) => ({ key: text(t.key).toLowerCase(), name: text(t.name || t.id) })),
    ],
    catalog,
  );
  const appearance = text(character.description);
  const clues = Array.isArray(character.clues) ? character.clues.map(text).filter(Boolean) : [];

  const details = (
    <>
      {facts.length ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className={labelClass}>{label}</dt>
              <dd className="mt-0.5 text-sm text-[var(--tfmc-cream)]">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="mt-4 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
        <ActionCard href={`/character/${id}/wardrobe`} icon={HANGER} title="Wardrobe" note={wornNote} />
        <ActionCard
          href={`/character/${id}/kits`}
          icon={CHEST}
          title="Kits"
          note={kit ? `Starter kit: ${kit}` : null}
        />
      </div>
    </>
  );

  return (
    <>
      <section
        aria-label={name}
        className="grid grid-cols-1 gap-x-3.5 gap-y-4 min-[360px]:grid-cols-[96px_minmax(0,1fr)] rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[radial-gradient(circle_at_80px_50%,color-mix(in_srgb,var(--tfmc-moss)_55%,transparent),transparent_260px),color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)] p-3.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6 sm:p-5"
      >
        <div className="sm:row-span-2">
          <CharacterFigure
            characterId={character.id}
            name={name}
            sessionToken={isPending ? null : sessionToken}
            playerUuid={playerUuid}
          />
        </div>
        <div className="min-w-0">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="break-words font-[family-name:var(--font-fraunces)] text-[26px] leading-tight text-[var(--tfmc-cream)] outline-none sm:text-[32px]"
          >
            {name}
          </h2>
          {lineage ? <p className="mt-1.5 text-[15px] text-[var(--tfmc-mist)] sm:text-base">{lineage}</p> : null}
        </div>
        <div className="col-span-full min-w-0 self-start sm:col-span-1 sm:col-start-2">{details}</div>
      </section>

      {isPending ? (
        <div
          role="status"
          className="mt-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_10%,transparent)] px-4 py-3 text-sm text-[var(--tfmc-cream)]"
        >
          <p>Being added to the server. You can still edit kits and wardrobe.</p>
          {onCancelPending ? (
            <button
              type="button"
              disabled={cancelling}
              onClick={() => {
                if (
                  !window.confirm(
                    "Cancel this submission? The pending character, wardrobe drafts, and kit customisations will be removed. This cannot be undone.",
                  )
                ) {
                  return;
                }
                void onCancelPending();
              }}
              className="mt-3 min-h-11 rounded-sm border border-[color-mix(in_srgb,#e8a0a0_45%,transparent)] px-3.5 text-sm text-[#e8a0a0] transition-colors hover:bg-[color-mix(in_srgb,#e8a0a0_10%,transparent)] disabled:opacity-50"
            >
              {cancelling ? "Cancelling…" : "Cancel submission"}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,1fr)_256px] md:gap-6">
        {attrs.length ? (
          <section>
            <h3 className={sectionHeadingClass}>Attributes</h3>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {attrs.map(({ key, value }) => {
                const ceiling = ceilings?.[key] ?? 0;
                return (
                  <li key={key} className={`${panelClass} flex h-[72px] flex-col justify-between px-3 py-2.5`}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] text-[var(--tfmc-mist)]">{displayAttrName(key)}</span>
                      <span className="font-[family-name:var(--font-fraunces)] text-[22px] leading-none tabular-nums text-[var(--tfmc-cream)]">
                        {value}
                        {ceiling > 0 ? <span className="sr-only"> of {ceiling}</span> : null}
                      </span>
                    </span>
                    {ceiling > 0 ? (
                      <span aria-hidden className="flex gap-1">
                        {Array.from({ length: ATTRIBUTE_SEGMENTS }, (_, i) => (
                          <span
                            key={i}
                            className="h-[5px] flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--tfmc-cream)_13%,transparent)]"
                          >
                            <span
                              className="block h-full bg-[var(--tfmc-accent)]"
                              style={{
                                width: `${Math.min(1, Math.max(0, (value * ATTRIBUTE_SEGMENTS - i * ceiling) / ceiling)) * 100}%`,
                              }}
                            />
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section className={attrs.length ? undefined : "md:col-span-2"}>
          <h3 className={sectionHeadingClass}>Profession EXP</h3>
          {xpMods.length ? (
            <ul className={`${panelClass} divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_7%,transparent)]`}>
              {xpMods.map((m) => {
                const label = text(m.alias).replace(/ Experience$/i, "") || capitalizeKey(text(m.profession));
                const amount = Number(m.amount);
                return (
                  <li
                    key={text(m.profession) || label}
                    className="flex h-9 items-center justify-between gap-3 px-3 text-sm"
                  >
                    <span className="truncate text-[var(--tfmc-cream)]">{label}</span>
                    <span
                      className={`font-semibold tabular-nums ${amount > 0 ? "text-[#9cc48a]" : amount < 0 ? "text-[#e0a39a]" : "text-[var(--tfmc-stone)]"}`}
                    >
                      {amount > 0 ? `+${amount}%` : amount < 0 ? `−${Math.abs(amount)}%` : "0%"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className={quietClass}>No profession EXP modifiers.</p>
          )}
        </section>
      </div>

      <Section title="Traits">
        {groups.length || timed.length ? (
          <>
            {groups.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-4">
                {groups.map((g) => (
                  <div key={g.key}>
                    <h4 className={`${labelClass} mb-2`}>{g.label}</h4>
                    <ul className="flex flex-wrap gap-1.5">
                      {g.tags.map((t) => (
                        <li
                          key={t.name}
                          title={t.description}
                          className="rounded-[2px] bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] px-2 py-0.5 text-sm text-[var(--tfmc-cream)]"
                        >
                          {t.name}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
            {timed.length ? (
              <div className={groups.length ? "mt-5 max-w-md" : "max-w-md"}>
                <h4 className={`${labelClass} mb-1`}>Temporary</h4>
                <ul>
                  {timed.map((t) => (
                    <li
                      key={t.id || t.name}
                      className="flex justify-between gap-3 border-b border-dashed border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] py-1.5 text-sm"
                    >
                      <span className="min-w-0 break-words text-[var(--tfmc-cream)]">{text(t.name || t.id)}</span>
                      <span className="shrink-0 text-[var(--tfmc-mist)]">{timedNote(t)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className={quietClass}>No traits recorded.</p>
        )}
      </Section>

      {appearance || origins.length || chosen.rest ? (
        <Section title="Story">
          {appearance ? (
            <>
              <h4 className={`${labelClass} mb-1.5`}>Appearance</h4>
              <Prose text={appearance} />
            </>
          ) : null}
          {origins.length ? (
            <dl className={`grid gap-2 sm:grid-cols-2 ${appearance ? "mt-5" : ""}`}>
              {origins.map((o) => (
                <div key={o.id} className={`${panelClass} px-3.5 py-3`}>
                  <dt className={labelClass}>{traitSelectionGroupLabel(o.key)}</dt>
                  <dd className="mt-1">
                    <span className="block font-[family-name:var(--font-fraunces)] text-lg leading-snug text-[var(--tfmc-cream)]">
                      {o.name}
                    </span>
                    <span className="mt-1 block text-sm leading-normal text-[var(--tfmc-mist)]">{o.description}</span>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
          {chosen.rest ? (
            <>
              <h4 className={`${labelClass} mb-1.5 ${appearance || origins.length ? "mt-5" : ""}`}>Background</h4>
              <Background text={chosen.rest} />
            </>
          ) : null}
        </Section>
      ) : null}

      <Section title="Clues">
        {clues.length ? (
          <ul className="space-y-2.5">
            {clues.map((clue, i) => (
              <li
                key={`${i}-${clue.slice(0, 24)}`}
                className="relative break-words pl-[22px] text-[15px] leading-normal text-[color-mix(in_srgb,var(--tfmc-cream)_85%,var(--tfmc-mist))] before:absolute before:left-1 before:top-[0.55em] before:h-[7px] before:w-[7px] before:rotate-45 before:bg-[var(--tfmc-accent)] before:opacity-80"
              >
                {clue}
              </li>
            ))}
          </ul>
        ) : (
          <p className={quietClass}>No clues discovered yet.</p>
        )}
      </Section>
    </>
  );
}

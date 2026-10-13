"use client";

import type { Ref } from "react";
import type { CharacterListItem, CreationCatalog } from "../../../lib/characters/api";
import { displayClass, displayRace } from "../../../lib/characters/displayNames";
import {
  ESTATE_PARTS,
  estateMoved,
  estateStatusLine,
  formatDay,
  formatDenars,
  recipientLabel,
} from "../../../lib/characters/wills";
import CharacterFigure from "./CharacterFigure";

type Props = {
  character: CharacterListItem;
  catalog?: CreationCatalog | null;
  sessionToken?: string | null;
  playerUuid?: string | null;
  headingRef?: Ref<HTMLHeadingElement>;
};

const labelClass = "text-xs font-bold uppercase tracking-[0.08em] text-[var(--tfmc-stone)]";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className={labelClass}>{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-[var(--tfmc-cream)]">{value}</dd>
    </div>
  );
}

/** A dead or missing character: when they died, their will and where their estate went. Read only. */
export default function CharacterMemorial({ character, catalog, sessionToken = null, playerUuid, headingRef }: Props) {
  const name = character.name || "Unnamed";
  const missing = String(character.status || "").toUpperCase() === "MISSING";
  const lineage = [displayRace(character, catalog), displayClass(character, catalog)].filter(Boolean).join(" · ");
  const estate = character.estate ?? null;
  const died = missing ? "Missing" : (formatDay(character.died_at) ?? "Before records began");

  const rows: [string, string][] = [[missing ? "Status" : "Died", died]];
  if (estate) {
    rows.push(["Heir", estate.heir_name || "No will"]);
    rows.push(["Estate", estateStatusLine(estate)]);
    for (const [part, label] of ESTATE_PARTS) {
      const to = recipientLabel(estate.recipients?.[part]);
      if (!to) continue;
      const cents = part === "money" ? estate.money_moved_cents : null;
      rows.push([label, cents ? `${to} (${formatDenars(cents)})` : to]);
    }
    const moved = estateMoved(estate);
    if (moved) rows.push(["Moved", moved]);
  }

  return (
    <section
      aria-label={name}
      className="grid grid-cols-1 gap-x-3.5 gap-y-4 min-[360px]:grid-cols-[96px_minmax(0,1fr)] rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_60%,transparent)] p-3.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-x-6 sm:p-5"
    >
      <div className="opacity-60 grayscale sm:row-span-2">
        <CharacterFigure characterId={character.id} name={name} sessionToken={sessionToken} playerUuid={playerUuid} />
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
      <dl className="col-span-full grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 self-start min-[400px]:grid-cols-2 sm:col-span-1 sm:col-start-2">
        {rows.map(([label, value]) => (
          <Row key={label} label={label} value={value} />
        ))}
      </dl>
    </section>
  );
}

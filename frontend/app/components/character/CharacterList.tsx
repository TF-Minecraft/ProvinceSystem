"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { minecraftHeadUrl } from "../../../lib/account/api";
import type { CharacterListItem, CreationCatalog } from "../../../lib/characters/api";
import { displayClass, displayRace } from "../../../lib/characters/displayNames";
import { characterFace } from "../../../lib/characters/face";

type Props = {
  characters: CharacterListItem[];
  aliveCount: number;
  maxSlots: number;
  catalog?: CreationCatalog | null;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Reads each character's wardrobe for its face. */
  sessionToken?: string | null;
  /** The player's own head stands in for a character without a skin. */
  playerUuid?: string | null;
};

/** Undefined while loading, null when the character has no skin of its own. */
type Faces = Record<string, string | null | undefined>;

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

const portraitClass =
  "h-14 w-14 shrink-0 rounded-[3px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]";

/** The face of the skin the character wears, else the player's own head. */
function Portrait({
  face,
  playerUuid,
  faded,
}: {
  face: string | null | undefined;
  playerUuid?: string | null;
  faded?: boolean;
}) {
  const [headFailed, setHeadFailed] = useState(false);
  const src =
    face ??
    (face === null && playerUuid && !headFailed ? `${minecraftHeadUrl()}?u=${encodeURIComponent(playerUuid)}` : null);
  if (!src) {
    return <span aria-hidden className={`${portraitClass} bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]`} />;
  }
  return (
    /* A data URL or our own API; next/image adds nothing for an 8×8 face. */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      width={56}
      height={56}
      onError={() => setHeadFailed(true)}
      className={`${portraitClass} [image-rendering:pixelated] ${faded ? "opacity-50 grayscale" : ""}`}
    />
  );
}

function Card({
  item,
  catalog,
  face,
  playerUuid,
}: {
  item: CharacterListItem;
  catalog?: CreationCatalog | null;
  face: string | null | undefined;
  playerUuid?: string | null;
}) {
  const status = statusOf(item);
  const name = item.name || "Unnamed";
  const meta = [displayRace(item, catalog), displayClass(item, catalog)].filter(Boolean).join(" · ");
  const err = String(item.error || "").trim();
  const chip = CHIPS[status];
  const linkable = Boolean(item.id) && (status === "ALIVE" || status === "PENDING");
  const faded = status === "DEAD" || status === "MISSING" || status === "REJECTED";
  const body = (
    <>
      <Portrait face={face} playerUuid={playerUuid} faded={faded} />
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

/** Characters with a roster row have a wardrobe; pending and rejected ones don't yet. */
const HAS_WARDROBE = new Set(["ALIVE", "DEAD", "MISSING"]);

function useFaces(sessionToken: string | null, characters: CharacterListItem[]): Faces {
  const [faces, setFaces] = useState<Faces>({});
  const ids = characters
    .filter((c) => c.id && HAS_WARDROBE.has(statusOf(c)))
    .map((c) => c.id)
    .join("\n");
  useEffect(() => {
    if (!sessionToken || !ids) return;
    let live = true;
    for (const id of ids.split("\n")) {
      characterFace(sessionToken, id)
        .catch(() => null)
        .then((face) => {
          if (live) setFaces((old) => ({ ...old, [id]: face }));
        });
    }
    return () => {
      live = false;
    };
  }, [sessionToken, ids]);
  // Characters with no wardrobe go straight to the player's head.
  const all: Faces = {};
  for (const c of characters) all[c.id] = HAS_WARDROBE.has(statusOf(c)) && sessionToken ? faces[c.id] : null;
  return all;
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
  sessionToken = null,
  playerUuid = null,
}: Props) {
  const faces = useFaces(sessionToken, characters);
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
          <Card key={c.id} item={c} catalog={catalog} face={faces[c.id]} playerUuid={playerUuid} />
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
              <Card key={c.id} item={c} catalog={catalog} face={faces[c.id]} playerUuid={playerUuid} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

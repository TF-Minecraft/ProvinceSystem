"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { Skeleton } from "../shared/LoadingSkeleton";
import {
  CharactersApiError,
  listCharacterKits,
  type CharacterKit,
  type CharacterKitItem,
  type CharacterListItem,
  type LoreItemDraft,
} from "../../../lib/characters/api";
import { uiDevCharacterKits } from "../../../lib/characters/kitsDev";
import type { ProfileCustomItem } from "../../../lib/profile/api";
import { characterPath, customItemId, profileHref } from "../../../lib/profile/paths";
import { ItemFrame } from "./ProfileItems";
import { STATUS_CHIPS } from "./Wardrobe";

const panelClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)]";
const buttonClass =
  "inline-flex min-h-8 items-center justify-center rounded-sm px-3 text-sm font-semibold transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]";
const primaryClass = `${buttonClass} bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)]`;
const secondaryClass = `${buttonClass} border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] text-[var(--tfmc-cream)]`;

function lower(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** "GOLD_COIN" → "Gold Coin": config paths shout. */
function titleCase(raw: string): string {
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function kitItemName(item: CharacterKitItem): string {
  const custom = String(item.customise?.display_name || "").trim();
  if (custom) return custom;
  const named = String(item.display_name || item.preview?.display_name || "").trim();
  if (named) return named;
  const path = (item.path || "").replace(/\(.*$/, "");
  return titleCase(path.slice(path.lastIndexOf(".") + 1)) || "Item";
}

/** The kit's state in a word: legacy "ineligible" kits can still be claimed in game. */
function kitStatus(kit: CharacterKit): string {
  if (!kit.claimable) return "Claimed";
  const status = lower(kit.status) || "eligible";
  if (status === "eligible" || status === "ineligible") return "Not yet claimed";
  if (status === "granted") return "Claimed";
  return titleCase(status);
}

function kitTerms(kit: CharacterKit): string {
  if (kit.once_per_character) return "Once per character";
  return kit.cooldown_hours ? `Every ${kit.cooldown_hours} hours` : "Repeatable";
}

/** Whether the player has started making the item their own. */
function isCustomised(c: LoreItemDraft | undefined): boolean {
  if (!c) return false;
  if (["pending_skin", "ready", "denied", "applied"].includes(lower(c.state))) return true;
  if (String(c.display_name || "").trim()) return true;
  if (Array.isArray(c.lore) && c.lore.some((l) => String(l || "").trim())) return true;
  return Boolean(c.existing_skin_id || c.submission_id || c.skin_slug);
}

/** The custom item chip, matching the Custom items tab. */
function chipFor(c: LoreItemDraft | undefined): string | null {
  if (!isCustomised(c)) return null;
  const state = lower(c!.state);
  if (state === "pending_skin") return lower(c!.submission_status) === "approved" ? "approved" : "pending";
  return state || "draft";
}

function Chip({ status }: { status: string }) {
  const chip = STATUS_CHIPS[status];
  if (!chip) return null;
  return (
    <span className={`rounded-sm px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${chip.className}`}>
      {chip.label}
    </span>
  );
}

function editHref(characterId: string, kitId: string, kitKey: string): string {
  const enc = encodeURIComponent;
  return `/character/${enc(characterId)}/kits/${enc(kitId)}/edit/${enc(kitKey)}`;
}

function ItemRow({
  item,
  kit,
  characterId,
  customItems,
  onOpenItem,
}: {
  item: CharacterKitItem;
  kit: CharacterKit;
  characterId: string;
  customItems: ProfileCustomItem[];
  onOpenItem: (id: string) => void;
}) {
  const chip = item.editable ? chipFor(item.customise) : null;
  const key = item.kit_key;
  const custom = key && customItems.some((c) => c.character_id === characterId && c.kit_key === key);
  const inReview = chip === "pending" || chip === "approved";
  const canEdit = Boolean(item.editable && key && kit.claimable && !inReview);

  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onOpenItem(customItemId(characterId, key!));
  }

  let action = null;
  if (custom) {
    action = (
      <a href={profileHref("items", customItemId(characterId, key!))} onClick={open} className={secondaryClass}>
        View
      </a>
    );
  } else if (canEdit) {
    action = (
      <Link href={editHref(characterId, kit.id, key!)} className={primaryClass}>
        Customise
      </Link>
    );
  }

  return (
    <li className="flex min-h-12 items-center gap-3 px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] text-[var(--tfmc-cream)]">
          <span className="break-words">{kitItemName(item)}</span>
          {chip ? <Chip status={chip} /> : null}
        </p>
        {canEdit && !chip ? (
          <p className="mt-0.5 text-xs text-[var(--tfmc-mist)]">Rename it or give it your own skin</p>
        ) : null}
      </div>
      {action}
      <span className="w-8 shrink-0 text-right text-sm tabular-nums text-[var(--tfmc-stone)]">×{item.amount}</span>
    </li>
  );
}

function KitCard({
  kit,
  characterId,
  customItems,
  onOpenItem,
}: {
  kit: CharacterKit;
  characterId: string;
  customItems: ProfileCustomItem[];
  onOpenItem: (id: string) => void;
}) {
  const status = kitStatus(kit);
  return (
    <section aria-labelledby={`kit-${kit.id}`} className="mt-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`kit-${kit.id}`} className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          {kit.display_name || titleCase(kit.id)} kit
        </h3>
        <p className="text-sm text-[var(--tfmc-mist)]">
          <span className={kit.claimable ? "font-semibold text-[var(--tfmc-accent)]" : undefined}>{status}</span>
          {" · "}
          {kitTerms(kit)}
        </p>
      </div>
      {kit.claimable ? (
        <p className="mb-3 text-sm text-[var(--tfmc-mist)]">
          Claim it in game with{" "}
          <code className="rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] px-1.5 py-0.5 text-[13px] text-[var(--tfmc-cream)]">
            /rpcharacter kit {kit.id}
          </code>
          . Customise items before you claim it.
        </p>
      ) : null}
      {kit.items.length ? (
        <ul className={`${panelClass} divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_7%,transparent)]`}>
          {kit.items.map((item, i) => (
            <ItemRow
              key={`${item.path}-${i}`}
              item={item}
              kit={kit}
              characterId={characterId}
              customItems={customItems}
              onOpenItem={onOpenItem}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--tfmc-mist)]">This kit is empty.</p>
      )}
    </section>
  );
}

/** The kits' outline while they load, in the shape they arrive in. */
function KitsSkeleton() {
  return (
    <div className="mt-5" aria-busy="true" aria-label="Loading kits…">
      <div className="mb-3 flex items-baseline gap-3">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="h-4 w-44" />
      </div>
      <div className={`${panelClass} divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_7%,transparent)]`}>
        {["w-40", "w-24", "w-28", "w-32", "w-20", "w-28"].map((w, i) => (
          <div key={i} className="flex min-h-12 items-center justify-between px-3.5">
            <Skeleton className={`h-4 ${w}`} />
            <Skeleton className="h-4 w-7" />
          </div>
        ))}
      </div>
    </div>
  );
}

type Props = {
  character: CharacterListItem | null;
  customItems: ProfileCustomItem[];
  /** Null in UI dev, which shows sample kits. */
  sessionToken: string | null;
  /** ← back to the character. */
  onBack: () => void;
  /** Opens a custom item in its tab. */
  onOpenItem: (id: string) => void;
};

/** A character's kits inside Profile: what each holds, and which items can be made the player's own. */
export default function ProfileKits({ character, customItems, sessionToken, onBack, onOpenItem }: Props) {
  const characterId = character?.id ?? "";
  const [kits, setKits] = useState<CharacterKit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!characterId) return;
    if (!sessionToken) {
      setKits(uiDevCharacterKits(characterId).kits);
      return;
    }
    let live = true;
    listCharacterKits(sessionToken, characterId)
      .then((data) => live && setKits(data.kits))
      .catch((err) => {
        if (live) setError(err instanceof CharactersApiError ? err.message : "Couldn’t load the kits.");
      });
    return () => {
      live = false;
    };
  }, [characterId, sessionToken]);

  // Opening the kits keeps Profile's header and tabs, and brings the back line under the site header.
  useEffect(() => {
    const frame = frameRef.current;
    const headerBottom = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    if (frame && frame.getBoundingClientRect().top < headerBottom) frame.scrollIntoView({ block: "start" });
  }, []);

  if (!character) {
    return (
      <ItemFrame tab="characters" onBack={onBack}>
        <p className="mt-6 text-sm text-[var(--tfmc-mist)]">This character isn’t on your profile.</p>
      </ItemFrame>
    );
  }

  return (
    <div ref={frameRef} className="scroll-mt-[calc(var(--tfmc-sticky-top)+12px)]">
      <ItemFrame
        tab="characters"
        backLabel={character.name || "Character"}
        backHref={characterPath(character.id)}
        onBack={onBack}
      >
        {error ? (
          <p className="mt-5 text-sm text-[#e8a0a0]" role="alert">
            {error}
          </p>
        ) : !kits ? (
          <KitsSkeleton />
        ) : kits.length === 0 ? (
          <p className="mt-5 text-sm text-[var(--tfmc-mist)]">No kits for this character.</p>
        ) : (
          kits.map((kit) => (
            <KitCard
              key={kit.id}
              kit={kit}
              characterId={character.id}
              customItems={customItems}
              onOpenItem={onOpenItem}
            />
          ))
        )}
      </ItemFrame>
    </div>
  );
}

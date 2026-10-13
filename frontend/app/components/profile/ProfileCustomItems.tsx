"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CharactersApiError,
  listCharacterKits,
  loreItemDefaultTextureUrl,
  type CharacterKit,
  type CharacterKitItem,
} from "../../../lib/characters/api";
import { hasInlineFormatCodes, parseNameRuns } from "../../../lib/characters/lorePreview";
import type { ProfileCustomItem } from "../../../lib/profile/api";
import { customItemId, parseCustomItemId, profileHref } from "../../../lib/profile/paths";
import { previewColourStopRuns } from "../../../lib/skins/namePreview";
import { HangerGlyph, WardrobeCard } from "./Wardrobe";
import { PictureSkeleton, SkinPicture } from "./WardrobePictures";
import { ItemFrame, Loading } from "./ProfileItems";
import { Facts, formatDay, Heading, Showcase, StagePicture, StatusBlock, Tooltip } from "./ItemShowcase";

// The backend falls back to kit_key when an item has no name; never show a raw key.
const KEY_LIKE = /^[a-z0-9]+(?:[._:-][a-z0-9]+)+$/;

function itemName(item: ProfileCustomItem): string {
  const name = String(item.display_name || "").trim();
  if (!name || name.toLowerCase() === item.kit_key.trim().toLowerCase() || KEY_LIKE.test(name)) return "Custom item";
  return name;
}

/** The wardrobe chip for an item's customise state. */
function chipStatus(item: ProfileCustomItem): string {
  const state = String(item.state || "").toLowerCase();
  if (state === "pending_skin") {
    return String(item.submission_status || "").toLowerCase() === "approved" ? "approved" : "pending";
  }
  return state;
}

function statusMessage(item: ProfileCustomItem, claimable: boolean): string {
  switch (chipStatus(item)) {
    case "pending":
      return "Its skin is waiting for staff review. Discord tells you when it’s decided.";
    case "approved":
      return "Its skin is approved and goes live within 24 hours.";
    case "ready":
      return claimable ? "Ready. Claim the kit in game to get it." : "Ready for the next time you claim the kit.";
    case "applied":
      return "Live in game.";
    case "denied":
      return "Denied. Edit it to try a different skin.";
    case "draft":
      return "Not sent yet.";
    default:
      return item.state;
  }
}

/** The skin the player made for the item, else the kit's own texture. */
function ItemPicture({ item, sessionToken }: { item: ProfileCustomItem; sessionToken: string }) {
  if (item.submission_id) return <SkinPicture id={item.submission_id} sessionToken={sessionToken} />;
  return <KitTexture kitKey={item.kit_key} sessionToken={sessionToken} />;
}

function KitTexture({ kitKey, sessionToken }: { kitKey: string; sessionToken: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    fetch(loreItemDefaultTextureUrl(kitKey), { headers: { Authorization: `Bearer ${sessionToken}` } })
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (!live) return;
        if (!blob) return setMissing(true);
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [kitKey, sessionToken]);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- object URL
    return <img src={src} alt="" className="h-full w-full object-contain p-[22%] [image-rendering:pixelated]" />;
  }
  return missing ? <HangerGlyph /> : <PictureSkeleton />;
}

export function CustomItemList({
  items,
  sessionToken,
  onOpen,
}: {
  items: ProfileCustomItem[];
  sessionToken: string;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-[var(--tfmc-mist)]">
        No custom items yet. Open a character’s kit to rename an item or give it your own skin.
      </p>
    );
  }
  return (
    <div>
      <p className="mb-3 text-sm text-[var(--tfmc-mist)]">
        {items.length === 1 ? "1 custom item" : `${items.length} custom items`}
      </p>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item) => {
          const id = customItemId(item.character_id, item.kit_key);
          return (
            <WardrobeCard
              key={id}
              onOpen={onOpen}
              item={{
                id,
                href: profileHref("items", id),
                name: itemName(item),
                detail: item.character_name,
                status: chipStatus(item),
                picture: <ItemPicture item={item} sessionToken={sessionToken} />,
              }}
            />
          );
        })}
      </ul>
    </div>
  );
}

type Found = { kit: CharacterKit; part: CharacterKitItem };

function findPart(kits: CharacterKit[], kitKey: string, kitId?: string): Found | null {
  const key = kitKey.toLowerCase();
  const ordered = [...kits.filter((k) => k.id === kitId), ...kits.filter((k) => k.id !== kitId)];
  for (const kit of ordered) {
    const part = kit.items.find((p) => p.kit_key?.toLowerCase() === key);
    if (part) return { kit, part };
  }
  return null;
}

function nameRuns(name: string, colours: string[], styles: string[]) {
  if (colours.length) return previewColourStopRuns(name, colours, styles);
  return parseNameRuns(hasInlineFormatCodes(name) ? name : `§f${name}`);
}

export function CustomItemView({
  id,
  items,
  sessionToken,
  onBack,
}: {
  id: string;
  items: ProfileCustomItem[];
  sessionToken: string;
  onBack: () => void;
}) {
  const ref = parseCustomItemId(id);
  const item = ref ? (items.find((i) => i.character_id === ref.characterId && i.kit_key === ref.kitKey) ?? null) : null;
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Keyed by the item's ids: Profile reloads its rows while anything is in review.
  const characterId = item?.character_id;
  const kitKey = item?.kit_key;
  const kitId = item?.kit_id;
  useEffect(() => {
    if (!characterId || !kitKey) {
      setLoading(false);
      return;
    }
    let live = true;
    listCharacterKits(sessionToken, characterId)
      .then((data) => live && setFound(findPart(data.kits, kitKey, kitId)))
      .catch((err) => {
        if (live) setError(err instanceof CharactersApiError ? err.message : "Couldn’t load this item.");
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [characterId, kitId, kitKey, sessionToken]);

  if (!item) {
    return (
      <ItemFrame tab="items" onBack={onBack}>
        <p className="mt-6 text-sm text-[var(--tfmc-mist)]">This item isn’t on your profile.</p>
      </ItemFrame>
    );
  }
  if (loading) {
    return (
      <ItemFrame tab="items" onBack={onBack}>
        <Loading />
      </ItemFrame>
    );
  }

  const draft = found?.part.customise;
  const name = itemName(item);
  const base = found?.part.preview;
  const customLore = (draft?.lore ?? []).map((l) => l.trim()).filter(Boolean);
  const baseLore = base?.lore ?? [];
  // In game the item keeps its own lore, then a gap, then the player's lines.
  const lore = customLore.length && baseLore.length ? [...baseLore, " ", ...customLore] : [...baseLore, ...customLore];
  const status = chipStatus(item);
  const editable = Boolean(found && found.kit.claimable && found.part.editable && status !== "pending");
  const editHref = found
    ? `/character/${encodeURIComponent(item.character_id)}/kits/${encodeURIComponent(found.kit.id)}/edit/${encodeURIComponent(item.kit_key)}`
    : null;

  return (
    <ItemFrame tab="items" onBack={onBack}>
      {error ? (
        <p className="mt-4 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      <Showcase
        stage={
          <StagePicture>
            <div className="h-full max-h-64 w-full max-w-64">
              <ItemPicture item={item} sessionToken={sessionToken} />
            </div>
          </StagePicture>
        }
      >
        <Heading
          title={name}
          detail={[item.character_name, found ? `${found.kit.display_name || found.kit.id} kit` : null]
            .filter(Boolean)
            .join(" · ")}
        />
        <StatusBlock
          status={status}
          message={statusMessage(item, Boolean(found?.kit.claimable))}
          reason={status === "denied" ? item.deny_reason?.trim() || null : null}
          action={
            editable && editHref ? (
              <Link
                href={editHref}
                className="inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90"
              >
                Edit item
              </Link>
            ) : null
          }
        />
        <Tooltip name={nameRuns(name, draft?.name_colours ?? [], draft?.name_styles ?? [])} lore={lore} />
        <Facts
          facts={[
            { label: "Character", value: item.character_name },
            found ? { label: "Kit", value: found.kit.display_name || found.kit.id } : null,
            base?.display_name
              ? {
                  label: "Made from",
                  value: parseNameRuns(base.display_name)
                    .map((r) => r.text)
                    .join(""),
                }
              : null,
            status === "ready" && formatDay(item.ready_at)
              ? { label: "Ready since", value: formatDay(item.ready_at) }
              : null,
            formatDay(item.applied_at) ? { label: "Live since", value: formatDay(item.applied_at) } : null,
          ]}
        />
      </Showcase>
    </ItemFrame>
  );
}

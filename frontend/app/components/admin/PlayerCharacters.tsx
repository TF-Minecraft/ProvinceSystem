"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getPlayerCharacterCatalog, playerCharacterPictureUrl, type PlayerProfile } from "../../../lib/admin/api";
import type { CreationCatalog } from "../../../lib/characters/api";
import { CharacterCard, CharacterRoster } from "../character/CharacterList";
import CharacterSheet from "../character/CharacterSheet";
import { ItemFrame } from "../profile/ProfileItems";
import { mutedClass } from "./ui";

/** The player's cards and sheet, addressed inside the staff player's Characters tab. */
export default function PlayerCharacters({ profile, active }: { profile: PlayerProfile; active: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("character");
  const realm = params.get("realm") || "main";
  const selected = profile.characters.find((c) => c.id === id && c.realm_id === realm);
  const base = `/admin/players/${encodeURIComponent(profile.uuid)}?tab=characters`;
  const [catalog, setCatalog] = useState<CreationCatalog | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    getPlayerCharacterCatalog()
      .then((next) => live && setCatalog(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [active]);

  useEffect(() => {
    if (!active || !selected) return;
    headingRef.current?.focus({ preventScroll: true });
    const frame = frameRef.current;
    const hero = headingRef.current?.closest("section");
    if (!frame || !hero) return;
    const headerBottom = Math.max(
      0,
      ...Array.from(document.querySelectorAll("header"))
        .filter((header) => ["fixed", "sticky"].includes(getComputedStyle(header).position))
        .map((header) => header.getBoundingClientRect().bottom),
    );
    if (frame.getBoundingClientRect().top < headerBottom || hero.getBoundingClientRect().bottom > window.innerHeight) {
      frame.scrollIntoView({ block: "start" });
    }
  }, [active, selected]);

  if (id) {
    return (
      <div
        ref={frameRef}
        className="scroll-mt-[calc(var(--tfmc-header-h)+12px)] md:scroll-mt-[calc(var(--tfmc-header-h)+5rem)]"
      >
        <ItemFrame tab="characters" backHref={base} onBack={() => router.push(base, { scroll: false })}>
          {selected ? (
            <div className="mt-3" key={`${selected.realm_id}:${selected.id}`}>
              <CharacterSheet
                character={selected}
                catalog={catalog}
                playerUuid={profile.uuid}
                figureUrl={active ? playerCharacterPictureUrl(profile.uuid, realm, id, "figure") : null}
                headingRef={headingRef}
                readOnly
              />
            </div>
          ) : (
            <p className={`mt-3 ${mutedClass}`} role="status">
              Character no longer available.
            </p>
          )}
        </ItemFrame>
      </div>
    );
  }

  return (
    <div className="animate-char-rise">
      {profile.characters.length ? (
        <CharacterRoster
          characters={profile.characters}
          includeOther
          renderCard={(c) => {
            const href = `${base}&character=${encodeURIComponent(c.id)}&realm=${encodeURIComponent(c.realm_id)}`;
            return (
              <CharacterCard
                key={`${c.realm_id}:${c.id}`}
                item={c}
                catalog={catalog}
                face={active ? playerCharacterPictureUrl(profile.uuid, c.realm_id, c.id, "face") : null}
                playerUuid={profile.uuid}
                href={href}
                onOpen={() => router.push(href, { scroll: false })}
                realmLabel={c.realm_id !== "main" ? c.realm_id : undefined}
              />
            );
          }}
        />
      ) : (
        <p className={`mt-3 ${mutedClass}`}>No characters.</p>
      )}
    </div>
  );
}

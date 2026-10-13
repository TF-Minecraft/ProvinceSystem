"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getPlayerCharacterCatalog, playerCharacterPictureUrl, type PlayerProfile } from "../../../lib/admin/api";
import type { CreationCatalog } from "../../../lib/characters/api";
import { CharacterCard } from "../character/CharacterList";
import CharacterSheet from "../character/CharacterSheet";
import { headingClass, mutedClass } from "./ui";

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
    if (active && selected) headingRef.current?.focus({ preventScroll: true });
  }, [active, selected]);

  const status = (value: string) => {
    const lower = String(value || "").toLowerCase();
    return lower ? lower[0].toUpperCase() + lower.slice(1) : "";
  };

  if (id) {
    return (
      <>
        <Link href={base} scroll={false} className="text-sm text-[var(--tfmc-accent)] hover:underline">
          ← Characters
        </Link>
        {selected ? (
          <div className="mt-3" key={`${selected.realm_id}:${selected.id}`}>
            <p className={`mb-3 ${mutedClass}`}>
              {[status(selected.status), selected.realm_id].filter(Boolean).join(" · ")}
            </p>
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
      </>
    );
  }

  return (
    <>
      <h3 className={headingClass}>Characters</h3>
      {profile.characters.length ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {profile.characters.map((c) => {
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
                note={[status(c.status), c.realm_id !== "main" ? c.realm_id : null].filter(Boolean).join(" · ")}
              />
            );
          })}
        </ul>
      ) : (
        <p className={`mt-3 ${mutedClass}`}>No characters.</p>
      )}
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import CharacterSheet from "../character/CharacterSheet";
import {
  CharactersApiError,
  deletePendingCreate,
  type CharacterListItem,
  type CreationCatalog,
} from "../../../lib/characters/api";
import { ItemFrame } from "./ProfileItems";

/** Characters that open in the tab; the rest only show on their card. */
export const OPENABLE = new Set(["ALIVE", "PENDING"]);

type Props = {
  /** The dashboard's row for the address's id, or null when Profile has none. */
  character: CharacterListItem | null;
  catalog: CreationCatalog | null;
  /** Null in UI dev, where nothing can be cancelled. */
  sessionToken: string | null;
  playerUuid?: string | null;
  /** ← back to the characters. */
  onBack: () => void;
  /** Back to the characters in place, when there's nothing to show. */
  onLeave: () => void;
  /** After a pending character is cancelled. */
  onCancelled: () => void;
};

/** One character's sheet inside Profile's Characters tab. */
export default function ProfileCharacter({
  character,
  catalog,
  sessionToken,
  playerUuid,
  onBack,
  onLeave,
  onCancelled,
}: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const status = String(character?.status || "").toUpperCase();
  const openable = OPENABLE.has(status);

  useEffect(() => {
    if (!openable) onLeave();
  }, [onLeave, openable]);

  // Opening a character (this mounts once per character) moves focus to its name, and scrolls it up
  // when Profile's header would push the hero off screen, as it does on phones.
  useEffect(() => {
    if (!openable) return;
    headingRef.current?.focus({ preventScroll: true });
    const hero = headingRef.current?.closest("section");
    if (hero && hero.getBoundingClientRect().bottom > window.innerHeight)
      frameRef.current?.scrollIntoView({ block: "start" });
  }, [openable]);

  if (!character || !openable) return null;

  async function onCancelPending() {
    if (!sessionToken || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await deletePendingCreate(sessionToken, character!.id);
      onCancelled();
    } catch (e) {
      setError(e instanceof CharactersApiError ? e.message : "Could not cancel submission.");
      setCancelling(false);
    }
  }

  return (
    <div ref={frameRef} className="scroll-mt-[calc(var(--tfmc-header-h)+12px)]">
      <ItemFrame tab="characters" onBack={onBack}>
        <div className="mt-3">
          {error ? (
            <p className="mb-4 text-sm text-[#e8a0a0]" role="alert">
              {error}
            </p>
          ) : null}
          <CharacterSheet
            character={character}
            catalog={catalog}
            sessionToken={sessionToken}
            playerUuid={playerUuid}
            headingRef={headingRef}
            onCancelPending={sessionToken ? onCancelPending : undefined}
            cancelling={cancelling}
          />
        </div>
      </ItemFrame>
    </div>
  );
}

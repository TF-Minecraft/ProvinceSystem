"use client";

import { useEffect, useState } from "react";
import CharacterSheet from "../character/CharacterSheet";
import PendingServerBanner from "../character/PendingServerBanner";
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
  /** ← back to the characters. */
  onBack: () => void;
  /** Back to the characters in place, when there's nothing to show. */
  onLeave: () => void;
  /** After a pending character is cancelled. */
  onCancelled: () => void;
};

/** One character's sheet inside Profile's Characters tab. */
export default function ProfileCharacter({ character, catalog, sessionToken, onBack, onLeave, onCancelled }: Props) {
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = String(character?.status || "").toUpperCase();
  const openable = OPENABLE.has(status);

  useEffect(() => {
    if (!openable) onLeave();
  }, [onLeave, openable]);

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
    <ItemFrame tab="characters" title={character.name || "Unnamed"} onBack={onBack}>
      {status === "PENDING" ? <PendingServerBanner className="mt-4" /> : null}
      {error ? (
        <p className="mt-4 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      <CharacterSheet
        character={character}
        catalog={catalog}
        onCancelPending={sessionToken ? onCancelPending : undefined}
        cancelling={cancelling}
      />
    </ItemFrame>
  );
}

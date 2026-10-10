"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CharacterSheet from "../../components/character/CharacterSheet";
import {
  CharactersApiError,
  deletePendingCreate,
  getCreationCatalog,
  listCharacters,
  type CharacterListItem,
  type CreationCatalog,
} from "../../../lib/characters/api";
import { logoutProfile } from "../../../lib/profile/uploads";
import {
  clearSession,
  getSession,
  isSessionValid,
  type CharacterSession,
} from "../../../lib/characters/session";
import {
  isCharacterUiDev,
  UI_DEV_SESSION_TOKEN,
} from "../../../lib/characters/uiDev";
import { uiDevSheetCharacter } from "../../../lib/characters/sheetDev";
import creationCatalogDev from "../../../lib/characters/fixtures/creationCatalog.dev.json";

function uiDevSession(): CharacterSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}

export default function CharacterDetailPage() {
  const router = useRouter();
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const uiDev = isCharacterUiDev();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [character, setCharacter] = useState<CharacterListItem | null>(null);
  const [catalog, setCatalog] = useState<CreationCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(
    async (token: string) => {
      setError(null);
      if (uiDev) {
        setCharacter(uiDevSheetCharacter(characterId));
        setCatalog(creationCatalogDev as CreationCatalog);
        return;
      }
      const [list, cat] = await Promise.all([
        listCharacters(token),
        getCreationCatalog(token).catch(() => null),
      ]);
      setCatalog(cat);
      const found =
        list.characters.find((c) => c.id === characterId) || null;
      setCharacter(found);
      if (!found) {
        setError("Character not found.");
      }
    },
    [characterId, uiDev]
  );

  useEffect(() => {
    if (!characterId) {
      setReady(true);
      setError("Missing character id.");
      return;
    }
    if (uiDev) {
      const s = uiDevSession();
      setSession(s);
      void load(s.session_token).finally(() => setReady(true));
      return;
    }
    const s = getSession();
    if (!s || !isSessionValid(s) || s.scope !== "profile") {
      clearSession();
      router.replace("/character");
      return;
    }
    setSession(s);
    void load(s.session_token)
      .catch((e) => {
        const msg =
          e instanceof CharactersApiError
            ? e.message
            : "Could not load character.";
        setError(msg);
      })
      .finally(() => setReady(true));
  }, [characterId, load, router, uiDev]);

  async function onLogout() {
    if (!session || loggingOut) return;
    setLoggingOut(true);
    try {
      if (!uiDev) {
        await logoutProfile(session.session_token);
      }
    } catch {
      /* still clear local */
    } finally {
      clearSession();
      router.replace("/character");
    }
  }

  async function onCancelPending() {
    if (!session || cancelling || uiDev) return;
    setCancelling(true);
    setError(null);
    try {
      await deletePendingCreate(session.session_token, characterId);
      router.replace("/character");
    } catch (e) {
      const msg =
        e instanceof CharactersApiError
          ? e.message
          : "Could not cancel submission.";
      setError(msg);
    } finally {
      setCancelling(false);
    }
  }

  if (!ready) {
    return (
      <p className="mt-8 text-sm text-[var(--tfmc-mist)]">Loading…</p>
    );
  }

  return (
    <div className="char-rise">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/character"
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
        >
          Back to characters
        </Link>
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
        >
          {loggingOut ? "Logging out…" : uiDev ? "Exit" : "Log out"}
        </button>
      </div>

      {error ? (
        <p className="text-sm text-[#e8a0a0]">{error}</p>
      ) : character ? (
        <CharacterSheet
          character={character}
          catalog={catalog}
          onCancelPending={uiDev ? undefined : onCancelPending}
          cancelling={cancelling}
        />
      ) : null}
    </div>
  );
}

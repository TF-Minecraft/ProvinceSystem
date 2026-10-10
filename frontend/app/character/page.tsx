"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CharacterList from "../components/character/CharacterList";
import {
  CharactersApiError,
  getCreationCatalog,
  listCharacters,
  maxAliveSlots,
  type CharacterListItem,
  type CreationCatalog,
} from "../../lib/characters/api";
import { logoutProfile } from "../../lib/profile/uploads";
import creationCatalogDev from "../../lib/characters/fixtures/creationCatalog.dev.json";
import {
  clearSession,
  getSession,
  isSessionValid,
  type CharacterSession,
} from "../../lib/characters/session";
import {
  isCharacterUiDev,
  UI_DEV_SESSION_TOKEN,
} from "../../lib/characters/uiDev";
import { UI_DEV_LORE_CHARACTER_ID } from "../../lib/characters/loreItemsDev";
import { uiDevSheetCharacter } from "../../lib/characters/sheetDev";
import { formatExpiresIn } from "../../lib/skins/formatTime";

const PENDING_POLL_MS = 10_000;

function uiDevSession(): CharacterSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}

function hasPending(characters: CharacterListItem[]): boolean {
  return characters.some((c) => String(c.status).toLowerCase() === "pending");
}

export default function CharacterPage() {
  const router = useRouter();
  const uiDev = isCharacterUiDev();
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<CharacterSession | null>(null);
  const [characters, setCharacters] = useState<CharacterListItem[]>([]);
  const [catalog, setCatalog] = useState<CreationCatalog | null>(null);
  const [maxSlots, setMaxSlots] = useState(3);
  const [webCreatorAllowed, setWebCreatorAllowed] = useState(true);
  const [webCreatorLockLabel, setWebCreatorLockLabel] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loadingList, setLoadingList] = useState(false);

  const loadList = useCallback(
    async (token: string, opts?: { quiet?: boolean }) => {
      if (uiDev) {
        setCharacters([uiDevSheetCharacter(UI_DEV_LORE_CHARACTER_ID)]);
        setCatalog(creationCatalogDev as CreationCatalog);
        setMaxSlots(5);
        setListError(null);
        setLoadingList(false);
        return;
      }
      if (!opts?.quiet) {
        setLoadingList(true);
      }
      setListError(null);
      try {
        const [list, cat] = await Promise.all([
          listCharacters(token),
          getCreationCatalog(token).catch(() => null),
        ]);
        setCharacters(list.characters);
        setCatalog(cat);
        if (typeof list.max_alive_characters === "number") {
          setMaxSlots(list.max_alive_characters);
        } else if (cat) {
          setMaxSlots(maxAliveSlots(cat.slot_limits));
        } else {
          setMaxSlots(3);
        }
        setWebCreatorAllowed(list.web_creator_allowed !== false);
        const minGroup = (list.web_creator_min_group_id || "").trim();
        if (list.web_creator_allowed === false) {
          const rank = minGroup
            ? minGroup.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : "donator";
          setWebCreatorLockLabel(
            `Needs ${rank} rank or higher. Just ranked up? Join the server once, then refresh.`
          );
        } else {
          setWebCreatorLockLabel("");
        }
      } catch (err) {
        if (err instanceof CharactersApiError && err.status === 401) {
          clearSession();
          setSessionState(null);
          setCharacters([]);
          return;
        }
        setListError(
          err instanceof Error ? err.message : "Could not load characters"
        );
      } finally {
        setLoadingList(false);
      }
    },
    [uiDev]
  );

  useEffect(() => {
    if (uiDev) {
      const next = uiDevSession();
      setSessionState(next);
      void loadList(next.session_token);
      setReady(true);
      return;
    }

    const existing = getSession();
    if (isSessionValid(existing)) {
      setSessionState(existing);
      void loadList(existing!.session_token);
    } else if (existing) {
      clearSession();
    }
    setReady(true);
  }, [loadList, uiDev]);

  // Poll while any create is pending.
  useEffect(() => {
    if (uiDev || !session || !isSessionValid(session)) return;
    if (!hasPending(characters)) return;
    const token = session.session_token;
    const id = window.setInterval(() => {
      void loadList(token, { quiet: true });
    }, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [characters, loadList, session, uiDev]);

  // Refresh when the tab becomes visible again.
  useEffect(() => {
    if (uiDev || !session || !isSessionValid(session)) return;
    const token = session.session_token;
    function onVisible() {
      if (document.visibilityState === "visible") {
        void loadList(token, { quiet: true });
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadList, session, uiDev]);

  useEffect(() => {
    if (!ready || uiDev) return;
    if (!session || !isSessionValid(session)) {
      router.replace("/profile");
    }
  }, [ready, session, uiDev, router]);

  function onRefresh() {
    if (!session) return;
    void loadList(session.session_token);
  }

  async function onLogout() {
    if (uiDev) {
      setSessionState(null);
      setCharacters([]);
      return;
    }
    if (!session) return;
    setLoggingOut(true);
    try {
      await logoutProfile(session.session_token);
    } catch {
      // still clear locally
    } finally {
      clearSession();
      setSessionState(null);
      setCharacters([]);
      setLoggingOut(false);
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col justify-center px-6 py-16">
        <p className="text-[var(--tfmc-mist)]">Loading…</p>
      </main>
    );
  }

  const valid = session && isSessionValid(session);
  const aliveCount = characters.filter(
    (c) => String(c.status).toUpperCase() === "ALIVE"
  ).length;

  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-80"
        style={{
          background: `
            radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--tfmc-moss) 35%, transparent), transparent 65%)
          `,
        }}
      />
      <div className="flex items-baseline gap-3">
        <h1 className="char-rise font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
          Character
        </h1>
        {uiDev ? (
          <span className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
            UI-dev
          </span>
        ) : null}
      </div>

      {valid ? (
        <div className="mt-4">
          <Link
            href="/profile"
            className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
          >
            Back to profile
          </Link>
          <p className="mt-3 text-sm text-[var(--tfmc-stone)]">
            {uiDev
              ? "UI-dev session - no redeem required."
              : `Session expires ${formatExpiresIn(session.expires_at)}`}
          </p>
          {loadingList && characters.length === 0 ? (
            <p className="mt-8 text-[var(--tfmc-mist)]">Loading characters…</p>
          ) : listError ? (
            <p className="mt-8 text-sm text-[#e8a0a0]" role="alert">
              {listError}
            </p>
          ) : (
            <CharacterList
              characters={characters}
              aliveCount={aliveCount}
              maxSlots={maxSlots}
              catalog={catalog}
              webCreatorAllowed={webCreatorAllowed}
              webCreatorLockLabel={webCreatorLockLabel}
              onLogout={onLogout}
              loggingOut={loggingOut}
              onRefresh={uiDev ? undefined : onRefresh}
              refreshing={loadingList}
            />
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-[var(--tfmc-mist)]">Redirecting to profile…</p>
      )}
    </main>
  );
}

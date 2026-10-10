"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CharactersApiError,
  listCharacterKits,
  type CharacterKit,
} from "../../../../lib/characters/api";
import { logoutProfile } from "../../../../lib/profile/uploads";
import {
  clearSession,
  getSession,
  isSessionValid,
  type CharacterSession,
} from "../../../../lib/characters/session";
import {
  isCharacterUiDev,
  UI_DEV_SESSION_TOKEN,
} from "../../../../lib/characters/uiDev";
import { uiDevCharacterKits } from "../../../../lib/characters/kitsDev";

function kitStatusLabel(kit: CharacterKit): string {
  if (!kit.claimable) return "Claimed";
  const status = String(kit.status || "").trim().toLowerCase() || "eligible";
  // Legacy "ineligible" kits are unclaimed and can still be claimed in-game.
  if (status === "eligible" || status === "ineligible") return "Not yet claimed";
  if (status === "granted") return "Claimed";
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function uiDevSession(): CharacterSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}

export default function CharacterKitsPage() {
  const router = useRouter();
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const uiDev = isCharacterUiDev();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [kits, setKits] = useState<CharacterKit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const load = useCallback(
    async (token: string) => {
      setError(null);
      try {
        if (uiDev) {
          const data = uiDevCharacterKits(characterId);
          setKits(data.kits);
          return;
        }
        const data = await listCharacterKits(token, characterId);
        setKits(data.kits);
      } catch (err) {
        setError(
          err instanceof CharactersApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load kits"
        );
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
    void load(s.session_token).finally(() => setReady(true));
  }, [characterId, load, router, uiDev]);

  async function onLogout() {
    if (!session || loggingOut) return;
    setLoggingOut(true);
    try {
      if (!uiDev) await logoutProfile(session.session_token);
    } catch {
      /* clear anyway */
    } finally {
      clearSession();
      router.replace("/character");
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
          href={`/character/${encodeURIComponent(characterId)}`}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
        >
          Back
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

      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">
        Kits
      </h1>

      {error ? (
        <p className="mt-4 text-sm text-[#e8a0a0]">{error}</p>
      ) : kits.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--tfmc-mist)]">No kits yet.</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {kits.map((kit) => (
            <li key={kit.id}>
              <Link
                href={`/character/${encodeURIComponent(characterId)}/kits/${encodeURIComponent(kit.id)}`}
                className="flex items-baseline justify-between gap-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-4 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
              >
                <span className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
                  {kit.display_name || kit.id}
                </span>
                <span className="text-xs text-[var(--tfmc-stone)]">
                  {kitStatusLabel(kit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

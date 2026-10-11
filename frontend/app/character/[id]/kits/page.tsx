"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CharactersApiError, listCharacterKits, type CharacterKit } from "../../../../lib/characters/api";
import { clearSession, getSession, isSessionValid } from "../../../../lib/characters/session";
import { isCharacterUiDev, uiDevSession } from "../../../../lib/characters/uiDev";
import { uiDevCharacterKits } from "../../../../lib/characters/kitsDev";

function kitStatusLabel(kit: CharacterKit): string {
  if (!kit.claimable) return "Claimed";
  const status =
    String(kit.status || "")
      .trim()
      .toLowerCase() || "eligible";
  // Legacy "ineligible" kits are unclaimed and can still be claimed in-game.
  if (status === "eligible" || status === "ineligible") return "Not yet claimed";
  if (status === "granted") return "Claimed";
  return status
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function CharacterKitsPage() {
  const router = useRouter();
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const uiDev = isCharacterUiDev();

  const [ready, setReady] = useState(false);
  const [kits, setKits] = useState<CharacterKit[]>([]);
  const [error, setError] = useState<string | null>(null);

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
          err instanceof CharactersApiError ? err.message : err instanceof Error ? err.message : "Failed to load kits",
        );
      }
    },
    [characterId, uiDev],
  );

  useEffect(() => {
    if (!characterId) {
      setReady(true);
      setError("Missing character id.");
      return;
    }
    if (uiDev) {
      const s = uiDevSession();
      void load(s.session_token).finally(() => setReady(true));
      return;
    }
    const s = getSession();
    if (!s || !isSessionValid(s) || s.scope !== "profile") {
      clearSession();
      router.replace("/profile");
      return;
    }
    void load(s.session_token).finally(() => setReady(true));
  }, [characterId, load, router, uiDev]);

  if (!ready) {
    return <p className="mt-8 text-sm text-[var(--tfmc-mist)]">Loading…</p>;
  }

  return (
    <div className="animate-char-rise">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/character/${encodeURIComponent(characterId)}`}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
        >
          Back
        </Link>
      </div>

      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">Kits</h1>

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
                <span className="text-xs text-[var(--tfmc-stone)]">{kitStatusLabel(kit)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

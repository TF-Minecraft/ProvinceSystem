"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import CustomiseStatusCard from "../../../../../../../components/character/CustomiseStatusCard";
import { CharactersApiError, listLoreItems, type LoreItemRow } from "../../../../../../../../lib/characters/api";
import { UI_DEV_LORE_CHARACTER_ID, uiDevLoreItemsResponse } from "../../../../../../../../lib/characters/loreItemsDev";
import {
  clearSession,
  getSession,
  isSessionValid,
  type CharacterSession,
} from "../../../../../../../../lib/characters/session";
import { isCharacterUiDev, uiDevSession } from "../../../../../../../../lib/characters/uiDev";

function customiseState(item: LoreItemRow): string {
  const fromRow = String(item.state || "")
    .trim()
    .toLowerCase();
  if (fromRow) return fromRow;
  return String(item.draft?.state || "")
    .trim()
    .toLowerCase();
}

export default function CharacterKitCustomiseStatusPage() {
  const router = useRouter();
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const kitId =
    String(params?.kitId || "")
      .trim()
      .toLowerCase() || "starter";
  const kitKey = String(params?.kitKey || "")
    .trim()
    .toLowerCase();
  const uiDev = isCharacterUiDev();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [item, setItem] = useState<LoreItemRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (token: string) => {
      setError(null);
      try {
        if (uiDev) {
          const data = uiDevLoreItemsResponse(characterId || UI_DEV_LORE_CHARACTER_ID);
          const match = data.items.find((r) => r.kit_key.toLowerCase() === kitKey) || data.items[0] || null;
          setItem(match);
          if (!match) setError("Editable item not found.");
          return;
        }
        const data = await listLoreItems(token, characterId, kitId);
        const match = data.items.find((r) => r.kit_key.toLowerCase() === kitKey) || null;
        setItem(match);
        if (!match) setError("This item can't be edited.");
      } catch (err) {
        setError(
          err instanceof CharactersApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load status",
        );
      }
    },
    [characterId, kitId, kitKey, uiDev],
  );

  useEffect(() => {
    if (!characterId || !kitKey) {
      setReady(true);
      setError("Item not found.");
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
      router.replace("/profile");
      return;
    }
    setSession(s);
    void load(s.session_token).finally(() => setReady(true));
  }, [characterId, kitKey, load, router, uiDev]);

  async function onRefresh() {
    if (!session || refreshing) return;
    setRefreshing(true);
    try {
      await load(session.session_token);
    } finally {
      setRefreshing(false);
    }
  }

  if (!ready) {
    return <p className="mt-8 text-sm text-[var(--tfmc-mist)]">Loading…</p>;
  }

  const kitHref = `/character/${encodeURIComponent(characterId)}/kits/${encodeURIComponent(kitId)}`;
  const editHref = `/character/${encodeURIComponent(characterId)}/kits/${encodeURIComponent(kitId)}/edit/${encodeURIComponent(kitKey)}`;
  const denied = item ? customiseState(item) === "denied" : false;

  return (
    <div className="animate-char-rise">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={kitHref}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
        >
          Back to kit
        </Link>
      </div>

      <h1 className="mb-4 font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">Item status</h1>

      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : item ? (
        <>
          <CustomiseStatusCard item={item} />
          <div className="mt-8 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
            {denied ? (
              <Link href={editHref} className="text-sm text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
                Edit again
              </Link>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import LoreItemEditor from "../../../../../../components/character/LoreItemEditor";
import {
  CharactersApiError,
  customiseLoreItem,
  deleteLoreItemCustomise,
  listLoreItems,
  logoutCharacter,
  type LoreItemRow,
} from "../../../../../../../lib/characters/api";
import {
  UI_DEV_LORE_CHARACTER_ID,
  uiDevApplyCustomise,
  uiDevDeleteCustomise,
  uiDevLoreItemsResponse,
} from "../../../../../../../lib/characters/loreItemsDev";
import {
  clearSession,
  getSession as getCharacterSession,
  isSessionValid as isCharacterSessionValid,
  type CharacterSession,
} from "../../../../../../../lib/characters/session";
import {
  isCharacterUiDev,
  UI_DEV_SESSION_TOKEN,
} from "../../../../../../../lib/characters/uiDev";

function uiDevSession(): CharacterSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}

export default function CharacterKitEditPage() {
  const router = useRouter();
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const kitId = String(params?.kitId || "").trim().toLowerCase() || "starter";
  const kitKey = String(params?.kitKey || "").trim().toLowerCase();
  const uiDev = isCharacterUiDev();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [item, setItem] = useState<LoreItemRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const statusHref = `/character/${encodeURIComponent(characterId)}/kits/${encodeURIComponent(kitId)}/edit/${encodeURIComponent(kitKey)}/status`;
  const backHref = `/character/${encodeURIComponent(characterId)}/kits/${encodeURIComponent(kitId)}`;

  const load = useCallback(
    async (token: string) => {
      setError(null);
      setFormError(null);
      try {
        if (uiDev) {
          const data = uiDevLoreItemsResponse(
            characterId || UI_DEV_LORE_CHARACTER_ID
          );
          const match =
            data.items.find((r) => r.kit_key.toLowerCase() === kitKey) ||
            data.items[0] ||
            null;
          setItem(match);
          if (!match) setError("Editable item not found.");
          return;
        }
        const data = await listLoreItems(token, characterId, kitId);
        const match =
          data.items.find((r) => r.kit_key.toLowerCase() === kitKey) || null;
        setItem(match);
        if (!match) setError("This item can't be edited.");
      } catch (err) {
        setError(
          err instanceof CharactersApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load item"
        );
      }
    },
    [characterId, kitId, kitKey, uiDev]
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
    const s = getCharacterSession();
    if (!s || !isCharacterSessionValid(s) || s.scope !== "profile") {
      clearSession();
      router.replace("/character");
      return;
    }
    setSession(s);
    void load(s.session_token).finally(() => setReady(true));
  }, [characterId, kitKey, load, router, uiDev]);

  async function onLogout() {
    if (!session || loggingOut) return;
    setLoggingOut(true);
    try {
      if (!uiDev) await logoutCharacter(session.session_token);
    } catch {
      /* clear */
    } finally {
      clearSession();
      router.replace("/character");
    }
  }

  async function onSubmit(input: {
    displayName: string;
    lore: string[];
    existingSkinId?: string | null;
    textureFile?: File | null;
    unsignedFile?: File | null;
    signedFile?: File | null;
    modelFile?: File | null;
    use3d?: boolean;
    nameColours?: string[];
    nameStyles?: string[];
  }) {
    if (!session || !item) return;
    setSubmitting(true);
    setFormError(null);
    try {
      if (uiDev) {
        uiDevApplyCustomise(item, input);
        router.push(statusHref);
        return;
      }
      await customiseLoreItem(
        session.session_token,
        characterId,
        item.kit_key,
        input,
        kitId
      );
      router.push(statusHref);
    } catch (err) {
      setFormError(
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Submit failed"
      );
      setSubmitting(false);
    }
  }

  async function onDelete() {
    if (!session || !item || deleting) return;
    setDeleting(true);
    setFormError(null);
    try {
      if (uiDev) {
        uiDevDeleteCustomise();
        router.push(backHref);
        return;
      }
      await deleteLoreItemCustomise(
        session.session_token,
        characterId,
        item.kit_key,
        kitId
      );
      router.push(backHref);
    } catch (err) {
      setFormError(
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Delete failed"
      );
      setDeleting(false);
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
          href={backHref}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
        >
          Back to kit
        </Link>
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut || submitting || deleting}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
        >
          {loggingOut ? "Logging out…" : uiDev ? "Exit" : "Log out"}
        </button>
      </div>

      <h1 className="mb-4 font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">
        Edit item
      </h1>

      {error ? (
        <p className="text-sm text-[#e8a0a0]">{error}</p>
      ) : item ? (
        <LoreItemEditor
          item={item}
          sessionToken={session?.session_token || UI_DEV_SESSION_TOKEN}
          nameColourStops={uiDev ? 4 : 4}
          submitting={submitting}
          deleting={deleting}
          error={formError}
          successMessage={null}
          onSubmit={onSubmit}
          onDelete={onDelete}
        />
      ) : null}
    </div>
  );
}

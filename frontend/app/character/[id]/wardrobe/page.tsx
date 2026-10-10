"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  getCreationCatalog,
  type CreationCatalog,
  type SlotLimits,
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
import { PERMISSION_GROUP_DISPLAY_NAMES } from "../../../../lib/characters/fixtures/permissionGroupDisplayNames.dev";
import WardrobeEditor from "../../../components/character/WardrobeEditor";

function uiDevSession(): CharacterSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}

/** UI-dev: unlocked swappable count from URL (always 3 frames shown). */
function parseUiDevUnlocked(): number {
  if (typeof window === "undefined") return 1;
  const search = new URLSearchParams(window.location.search);
  const raw =
    search.get("wardrobeSlots") ??
    search.get("skinslots") ??
    search.get("skinSlots");
  if (raw == null || raw === "") return 1;
  return Math.max(1, Math.min(3, Number(raw) || 1));
}

/** Mock rank ladder for lock-label preview only (UI-dev). */
function uiDevSlotLimits(): SlotLimits {
  return {
    defaults: { wardrobe_skin_slots: 1 },
    groups: [
      {
        id: "gilded",
        tier: 2,
        visible: true,
        wardrobe_skin_slots: 2,
        display_name: PERMISSION_GROUP_DISPLAY_NAMES.gilded,
      },
      {
        id: "ascended",
        tier: 3,
        visible: true,
        wardrobe_skin_slots: 3,
        display_name: PERMISSION_GROUP_DISPLAY_NAMES.ascended,
      },
    ],
  };
}

export default function CharacterWardrobePage() {
  const router = useRouter();
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const uiDev = isCharacterUiDev();

  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [slotLimits, setSlotLimits] = useState<SlotLimits | undefined>();
  const [uiDevUnlocked, setUiDevUnlocked] = useState(1);
  const [loggingOut, setLoggingOut] = useState(false);

  const loadCatalog = useCallback(
    async (token: string) => {
      if (uiDev) {
        setSlotLimits(uiDevSlotLimits());
        return;
      }
      const catalog = await getCreationCatalog(token).catch(
        () => null as CreationCatalog | null
      );
      setSlotLimits(catalog?.slot_limits);
    },
    [uiDev]
  );

  useEffect(() => {
    if (!characterId) {
      setReady(true);
      return;
    }
    if (uiDev) {
      setUiDevUnlocked(parseUiDevUnlocked());
      const s = uiDevSession();
      setSession(s);
      void loadCatalog(s.session_token).finally(() => setReady(true));
      return;
    }
    const s = getSession();
    if (!s || !isSessionValid(s) || s.scope !== "profile") {
      router.replace("/character");
      return;
    }
    setSession(s);
    void loadCatalog(s.session_token).finally(() => setReady(true));
  }, [characterId, loadCatalog, router, uiDev]);

  async function onLogout() {
    if (!session || loggingOut) return;
    setLoggingOut(true);
    try {
      if (!uiDev) await logoutProfile(session.session_token);
    } catch {
      /* still clear local */
    }
    clearSession();
    router.replace("/character");
  }

  if (!ready) {
    return (
      <p className="text-sm text-[var(--tfmc-mist)]">Loading wardrobe…</p>
    );
  }

  if (!characterId || !session) {
    return (
      <p className="text-sm text-red-300" role="alert">
        Missing character id.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/character/${encodeURIComponent(characterId)}`}
            className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:underline"
          >
            ← Character
          </Link>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl text-[var(--tfmc-cream)]">
            Wardrobe
          </h1>
          {uiDev ? (
            <p className="mt-2 text-xs text-[var(--tfmc-stone)]">
              UI-dev: 3 swappable frames ·{" "}
              <span className="text-[var(--tfmc-cream)]">
                {uiDevUnlocked} unlocked
              </span>{" "}
              (?wardrobeSlots=1|2|3)
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={loggingOut}
          onClick={() => void onLogout()}
          className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:underline disabled:opacity-50"
        >
          {loggingOut ? "…" : uiDev ? "Exit" : "Log out"}
        </button>
      </div>

      <WardrobeEditor
        mode="live"
        characterId={characterId}
        sessionToken={session.session_token}
        slotLimits={slotLimits}
        uiDev={uiDev}
        uiDevSwappableSlots={uiDev ? uiDevUnlocked : undefined}
      />
    </div>
  );
}

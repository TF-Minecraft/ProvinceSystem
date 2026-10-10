"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CreationWizard from "../../components/character/CreationWizard";
import {
  CharactersApiError,
  getCreationCatalog,
  listCharacters,
  type CreationCatalog,
} from "../../../lib/characters/api";
import { logoutProfile } from "../../../lib/profile/uploads";
import creationCatalogDev from "../../../lib/characters/fixtures/creationCatalog.dev.json";
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

export default function CharacterCreatePage() {
  const router = useRouter();
  const uiDev = isCharacterUiDev();
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<CharacterSession | null>(null);
  const [catalog, setCatalog] = useState<CreationCatalog | null>(null);
  const [skipRealAge, setSkipRealAge] = useState(false);
  const [evilUnlocked, setEvilUnlocked] = useState(false);
  const [accountAgeSeconds, setAccountAgeSeconds] = useState(0);
  const [nameColourStops, setNameColourStops] = useState(0);
  const [wardrobeSkinSlots, setWardrobeSkinSlots] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (uiDev) {
      setSession({
        session_token: UI_DEV_SESSION_TOKEN,
        player_uuid: "00000000-0000-4000-8000-ui0000000001",
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        scope: "profile",
      });
      setCatalog(creationCatalogDev as CreationCatalog);
      // UI-dev keeps age stages so the flow is visible; skip via ?skipAge=1.
      const params =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const skip = params?.get("skipAge") === "1";
      setSkipRealAge(Boolean(skip));

      const hoursRaw = params?.get("accountAgeHours");
      const unlockedParam = params?.get("evilUnlocked");
      const catalogHours = Number(
        (creationCatalogDev as CreationCatalog).validation?.clues
          ?.evil_min_account_age_hours ?? 24
      );
      const unlockHours = Number.isFinite(catalogHours) ? catalogHours : 24;
      if (hoursRaw != null && hoursRaw !== "") {
        const hours = Math.max(0, Number(hoursRaw) || 0);
        setAccountAgeSeconds(hours * 3600);
        setEvilUnlocked(hours >= unlockHours);
      } else if (unlockedParam === "1") {
        setEvilUnlocked(true);
        setAccountAgeSeconds(unlockHours * 3600);
      } else {
        setEvilUnlocked(false);
        setAccountAgeSeconds(0);
      }
      const colourStopsRaw = params?.get("colourStops");
      if (colourStopsRaw != null && colourStopsRaw !== "") {
        setNameColourStops(Math.max(0, Math.min(8, Number(colourStopsRaw) || 0)));
      } else {
        setNameColourStops(0);
      }
      const wardrobeSlotsRaw = params?.get("wardrobeSlots");
      if (wardrobeSlotsRaw != null && wardrobeSlotsRaw !== "") {
        setWardrobeSkinSlots(
          Math.max(1, Math.min(3, Number(wardrobeSlotsRaw) || 1))
        );
      } else {
        setWardrobeSkinSlots(1);
      }
      setReady(true);
      return;
    }

    const existing = getSession();
    if (!isSessionValid(existing)) {
      clearSession();
      router.replace("/character");
      return;
    }
    setSession(existing);
    void (async () => {
      try {
        const [cat, list] = await Promise.all([
          getCreationCatalog(existing!.session_token),
          listCharacters(existing!.session_token),
        ]);
        if (!cat.updated_at || !(cat.stages || []).length) {
          setError("Character creation is unavailable right now.");
        } else {
          setCatalog(cat);
        }
        setSkipRealAge(Boolean(list.real_age_set));
        const ageSec = Math.max(0, Number(list.account_age_seconds) || 0);
        setAccountAgeSeconds(ageSec);
        if (typeof list.evil_unlocked === "boolean") {
          setEvilUnlocked(list.evil_unlocked);
        } else {
          const hours = Number(
            cat.validation?.clues?.evil_min_account_age_hours ?? 24
          );
          const unlockHours = Number.isFinite(hours) ? hours : 24;
          setEvilUnlocked(ageSec >= unlockHours * 3600);
        }
        setNameColourStops(
          Math.max(0, Math.min(8, Number(list.name_colour_stops) || 0))
        );
        setWardrobeSkinSlots(
          Math.max(1, Math.min(3, Number(list.wardrobe_skin_slots) || 1))
        );
        if (list.web_creator_allowed === false) {
          const minGroup = (list.web_creator_min_group_id || "").trim();
          const rank = minGroup
            ? minGroup.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
            : "donator";
          setError(
            `Needs ${rank} rank or higher. Just ranked up? Join the server once, then refresh.`,
          );
          setCatalog(null);
          return;
        }
      } catch (err) {
        if (err instanceof CharactersApiError && err.status === 401) {
          clearSession();
          router.replace("/character");
          return;
        }
        setError(
          err instanceof Error ? err.message : "Couldn't load. Try again.",
        );
      } finally {
        setReady(true);
      }
    })();
  }, [router, uiDev]);

  async function onLogout() {
    if (uiDev) {
      router.replace("/character");
      return;
    }
    if (!session) return;
    setLoggingOut(true);
    try {
      await logoutProfile(session.session_token);
    } catch {
      // clear locally anyway
    } finally {
      clearSession();
      router.replace("/character");
    }
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col justify-center px-6 py-16">
        <p className="text-[var(--tfmc-mist)]">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-8 sm:py-12">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="char-rise font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">
            Create
          </h1>
          {uiDev ? (
            <span className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
              UI-dev
            </span>
          ) : null}
        </div>
        <Link
          href="/character"
          className="text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
        >
          Back to list
        </Link>
      </div>

      {error ? (
        <p className="mt-8 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : catalog && session ? (
        <CreationWizard
          catalog={catalog}
          sessionToken={session.session_token}
          onLogout={() => void onLogout()}
          loggingOut={loggingOut}
          uiDev={uiDev}
          skipRealAge={skipRealAge}
          evilUnlocked={evilUnlocked}
          accountAgeSeconds={accountAgeSeconds}
          nameColourStops={nameColourStops}
          wardrobeSkinSlots={wardrobeSkinSlots}
        />
      ) : null}
    </main>
  );
}

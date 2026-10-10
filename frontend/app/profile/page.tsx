"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CharacterList from "../components/character/CharacterList";
import ProfileCustomItemsList from "../components/profile/ProfileCustomItemsList";
import ProfileRedeemForm from "../components/profile/ProfileRedeemForm";
import ProfileSubmissionList from "../components/profile/ProfileSubmissionList";
import SupporterPanel from "../components/profile/SupporterPanel";
import { logoutCharacter } from "../../lib/characters/api";
import {
  ProfileApiError,
  getProfileDashboard,
  type ProfileDashboard,
} from "../../lib/profile/api";
import {
  clearSession,
  getSession,
  isSessionValid,
  type ProfileSession,
} from "../../lib/profile/session";
import {
  isCharacterUiDev,
  UI_DEV_SESSION_TOKEN,
} from "../../lib/characters/uiDev";
import { UI_DEV_LORE_CHARACTER_ID } from "../../lib/characters/loreItemsDev";
import { uiDevSheetCharacter } from "../../lib/characters/sheetDev";
import { formatExpiresIn } from "../../lib/skins/formatTime";
import { discordSignInUrl, getAccount, signOut } from "../../lib/account/api";
import { linkedProfileSession } from "../../lib/account/profileSession";
import { DiscordSignInLink } from "../components/account/BrandButtons";

type TabId = "characters" | "skins" | "drinks" | "items";

const TABS: readonly TabId[] = ["characters", "skins", "drinks", "items"];

function tabFromUrl(): TabId {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return TABS.find((t) => t === tab) ?? "characters";
}

/** What a visitor without a Profile session can do instead of entering a code. */
type DiscordState = "checking" | "signed_out" | "not_linked" | "unavailable";

const PENDING_POLL_MS = 10_000;

function uiDevSession(): ProfileSession {
  return {
    session_token: UI_DEV_SESSION_TOKEN,
    player_uuid: "00000000-0000-4000-8000-ui0000000001",
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    scope: "profile",
  };
}

function uiDevDashboard(): ProfileDashboard {
  return {
    characters: [uiDevSheetCharacter(UI_DEV_LORE_CHARACTER_ID)],
    max_alive_characters: 5,
    skins: [],
    drinks: [],
    custom_items: [],
  };
}

function hasPending(dashboard: ProfileDashboard | null): boolean {
  if (!dashboard) return false;
  if (
    dashboard.characters.some(
      (c) => String(c.status).toLowerCase() === "pending"
    )
  ) {
    return true;
  }
  if (dashboard.skins.some((s) => s.status === "pending")) return true;
  if (dashboard.drinks.some((d) => d.status === "pending")) return true;
  if (
    dashboard.custom_items.some(
      (i) =>
        i.state === "pending_skin" ||
        (i.submission_status || "").toLowerCase() === "pending"
    )
  ) {
    return true;
  }
  return false;
}

export default function ProfilePage() {
  const uiDev = isCharacterUiDev();
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<ProfileSession | null>(null);
  const [dashboard, setDashboard] = useState<ProfileDashboard | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [tab, setTab] = useState<TabId>("characters");
  const [discord, setDiscord] = useState<DiscordState>("checking");

  const loadDashboard = useCallback(
    async (token: string, opts?: { quiet?: boolean }) => {
      if (uiDev) {
        setDashboard(uiDevDashboard());
        setLoadError(null);
        setLoadingDashboard(false);
        return;
      }
      if (!opts?.quiet) setLoadingDashboard(true);
      setLoadError(null);
      try {
        const data = await getProfileDashboard(token);
        setDashboard(data);
      } catch (err) {
        if (err instanceof ProfileApiError && err.status === 401) {
          clearSession();
          setSessionState(null);
          setDashboard(null);
        } else {
          setLoadError(
            err instanceof Error ? err.message : "Could not load profile"
          );
        }
      } finally {
        if (!opts?.quiet) setLoadingDashboard(false);
      }
    },
    [uiDev]
  );

  useEffect(() => {
    if (uiDev) {
      const next = uiDevSession();
      setSessionState(next);
      setDashboard(uiDevDashboard());
      setReady(true);
      return;
    }
    setTab(tabFromUrl());
    const existing = getSession();
    if (isSessionValid(existing)) {
      setSessionState(existing);
      void loadDashboard(existing!.session_token);
      setReady(true);
      return;
    }
    if (existing) clearSession();
    // A Discord sign-in with a linked Minecraft account opens Profile without a code.
    let live = true;
    (async () => {
      try {
        const account = await getAccount();
        const uuid = account?.minecraft?.player_uuid;
        if (!uuid) {
          if (live) setDiscord(account ? "not_linked" : "signed_out");
          return;
        }
        const next = await linkedProfileSession(uuid);
        if (!live) return;
        setSessionState(next);
        void loadDashboard(next.session_token);
      } catch {
        if (live) setDiscord("unavailable");
      } finally {
        if (live) setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [loadDashboard, uiDev]);

  useEffect(() => {
    if (uiDev || !session || !isSessionValid(session)) return;
    if (!hasPending(dashboard)) return;
    const token = session.session_token;
    const id = window.setInterval(() => {
      void loadDashboard(token, { quiet: true });
    }, PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [dashboard, loadDashboard, session, uiDev]);

  function onRedeemed(next: ProfileSession) {
    setSessionState(next);
    void loadDashboard(next.session_token);
  }

  async function onLogout() {
    if (uiDev) {
      setSessionState(null);
      setDashboard(null);
      return;
    }
    if (!session) return;
    setLoggingOut(true);
    const fromDiscord = session.source === "discord";
    try {
      await logoutCharacter(session.session_token);
    } catch {
      // still clear locally
    }
    // Opened through Discord: stay signed out rather than reopening on the next visit.
    if (fromDiscord) {
      try {
        await signOut();
      } catch {
        // The Account page shows if the Discord session is still active.
      }
    }
    clearSession();
    setSessionState(null);
    setDashboard(null);
    if (fromDiscord) setDiscord("signed_out");
    setLoggingOut(false);
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl flex-col justify-center px-6 py-16">
        <p className="text-[var(--tfmc-mist)]">Loading…</p>
      </main>
    );
  }

  const valid = session && isSessionValid(session);
  const aliveCount = (dashboard?.characters || []).filter(
    (c) => String(c.status).toUpperCase() === "ALIVE"
  ).length;

  return (
    <main className="relative mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-3xl flex-col px-6 py-16">
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
        <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
          Profile
        </h1>
        {uiDev ? (
          <span className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
            UI-dev
          </span>
        ) : null}
      </div>

      {!valid ? (
        <>
          {discord === "signed_out" ? (
            <>
              <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
                Sign in with the Discord account linked to your Minecraft account.
              </p>
              <div className="mt-6 flex">
                <DiscordSignInLink href={discordSignInUrl("/profile")} />
              </div>
            </>
          ) : null}
          {discord === "not_linked" ? (
            <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
              <Link href="/account" className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
                Link your Minecraft account
              </Link>{" "}
              to open your Profile without a code.
            </p>
          ) : null}
          <p className="mt-6 text-sm text-[var(--tfmc-mist)]">
            {discord === "signed_out" || discord === "not_linked" ? "Or run " : "Run "}
            <code className="text-[var(--tfmc-accent)]">/token create profile</code> in game,
            then enter the code below.
          </p>
          <ProfileRedeemForm onRedeemed={onRedeemed} />
        </>
      ) : (
        <>
          <SupporterPanel sessionToken={session!.session_token} />
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--tfmc-stone)]">
            {session!.source === "discord" ? (
              <span>
                Opened through your{" "}
                <Link href="/account" className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
                  linked Discord account
                </Link>
              </span>
            ) : (
              <span>Session expires {formatExpiresIn(session!.expires_at)}</span>
            )}
            <button
              type="button"
              onClick={() => void onLogout()}
              disabled={loggingOut}
              className="text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
            >
              {session!.source === "discord"
                ? loggingOut ? "Signing out…" : "Sign out"
                : loggingOut ? "Logging out…" : "Log out"}
            </button>
          </div>

          <nav
            className="mt-8 flex flex-wrap gap-2 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pb-3"
            aria-label="Profile sections"
          >
            {(
              [
                ["characters", "Characters"],
                ["skins", "Skins"],
                ["drinks", "Drinks"],
                ["items", "Custom items"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === id
                    ? "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] text-[var(--tfmc-cream)]"
                    : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {loadError ? (
            <p className="mt-4 text-sm text-[#e8a0a0]">{loadError}</p>
          ) : null}

          {loadingDashboard && !dashboard ? (
            <p className="mt-6 text-sm text-[var(--tfmc-mist)]">Loading…</p>
          ) : dashboard ? (
            <div className="mt-6">
              {tab === "characters" ? (
                <>
                  <Link
                    href="/character"
                    className="mb-6 inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)]"
                  >
                    Open character hub
                  </Link>
                  <CharacterList
                    characters={dashboard.characters}
                    aliveCount={aliveCount}
                    maxSlots={dashboard.max_alive_characters ?? 3}
                    onLogout={() => void onLogout()}
                    loggingOut={loggingOut}
                    onRefresh={() =>
                      void loadDashboard(session!.session_token)
                    }
                    refreshing={loadingDashboard}
                  />
                </>
              ) : null}
              {tab === "skins" ? (
                <ProfileSubmissionList kind="skins" rows={dashboard.skins} />
              ) : null}
              {tab === "drinks" ? (
                <ProfileSubmissionList kind="drinks" rows={dashboard.drinks} />
              ) : null}
              {tab === "items" ? (
                <ProfileCustomItemsList items={dashboard.custom_items} />
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

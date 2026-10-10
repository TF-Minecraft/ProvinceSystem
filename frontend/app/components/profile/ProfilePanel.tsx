"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import CharacterList from "../character/CharacterList";
import ProfileCustomItemsList from "./ProfileCustomItemsList";
import ProfileRedeemForm from "./ProfileRedeemForm";
import { DrinkWardrobe, SkinWardrobe } from "./ProfileWardrobes";
import LinkedAccounts, {
  ACCOUNTS_PATH,
  cardClass,
  formatDate,
  formatDeadline,
  PlayerHead,
  quietButtonClass,
  type Load,
} from "../account/LinkedAccounts";
import { DiscordSignInLink } from "../account/BrandButtons";
import {
  discordSignInUrl,
  getAccount,
  getAccountOverview,
  minecraftLinkMessage,
  signInMessage,
  AccountApiError,
  type Account,
  type AccountOverview,
} from "../../../lib/account/api";
import { linkedProfileSession } from "../../../lib/account/profileSession";
import {
  DEFAULT_ACCOUNT_SHAPE,
  encodeAccountShape,
  rememberAccountShape,
  type AccountShape,
} from "../../../lib/account/shape";
import { isCharacterUiDev, UI_DEV_SESSION_TOKEN } from "../../../lib/characters/uiDev";
import { UI_DEV_LORE_CHARACTER_ID } from "../../../lib/characters/loreItemsDev";
import { uiDevSheetCharacter } from "../../../lib/characters/sheetDev";
import { ProfileApiError, getProfileDashboard, type ProfileDashboard } from "../../../lib/profile/api";
import { clearSession, getSession, isSessionValid, type ProfileSession } from "../../../lib/profile/session";
import type { ProfileTab } from "../../../lib/profile/tabs";
import { logoutProfile } from "../../../lib/profile/uploads";

const CONTENT_TABS: readonly [ProfileTab, string][] = [
  ["characters", "Characters"],
  ["skins", "Skins"],
  ["drinks", "Drinks"],
  ["items", "Custom items"],
];
const ACCOUNTS_TAB: [ProfileTab, string] = ["accounts", "Linked accounts"];

const sectionHeadingClass = "font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]";
const titleClass = "font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl";
const chipClass = "rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider";
const placeholderClass = "bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]";
const tabClass = "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors";
const activeTabClass = "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] text-[var(--tfmc-cream)]";
const idleTabClass = "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]";
const tabBarClass = "mt-8 flex flex-wrap gap-2 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pb-3";

/** Longest the page waits for the activity line and Profile before showing without them. */
const EXTRAS_WAIT_MS = 2500;
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
    can_start: {
      skin: { can_start: true, reason: null, next_at: null },
      drink: { can_start: false, reason: "cooldown", next_at: new Date(Date.now() + 3 * 86400000).toISOString() },
    },
  };
}

function hasPending(dashboard: ProfileDashboard | null): boolean {
  if (!dashboard) return false;
  const status = (value: unknown) => String(value || "").toLowerCase();
  return (
    dashboard.characters.some((c) => status(c.status) === "pending") ||
    dashboard.skins.some((s) => s.status === "pending") ||
    dashboard.drinks.some((d) => d.status === "pending") ||
    dashboard.custom_items.some((i) => i.state === "pending_skin" || status(i.submission_status) === "pending")
  );
}

const AGO_STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 3600],
  ["day", 86400],
  ["month", 2_592_000],
  ["year", 31_536_000],
];

function formatAgo(epochSeconds: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (seconds < 60) return "just now";
  let [unit, size] = AGO_STEPS[0];
  for (const step of AGO_STEPS) if (seconds >= step[1]) [unit, size] = step;
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(-Math.floor(seconds / size), unit);
}

function activityParts(overview: AccountOverview | null): ReactNode[] {
  const activity = overview?.activity;
  if (!activity) return [];
  const where = activity.server_label ? ` on ${activity.server_label}` : "";
  const parts: ReactNode[] = [];
  if (activity.online) {
    parts.push(
      <span key="seen">
        <span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--tfmc-accent)]" />
        Online now{where}
      </span>
    );
  } else if (activity.last_seen) {
    const ago = formatAgo(activity.last_seen);
    parts.push(
      <span key="seen">{activity.server_label ? `Last on ${activity.server_label} ${ago}` : `Last seen ${ago}`}</span>
    );
  }
  if (activity.first_seen) parts.push(<span key="since">playing since {formatDate(activity.first_seen)}</span>);
  return parts;
}

/** The parts of the line under the name. */
function sublineParts(account: Account, overview: AccountOverview | null): ReactNode[] {
  if (account.minecraft) return activityParts(overview);
  const { user } = account;
  const name = user.discord_username ? `@${user.discord_username}` : user.discord_global_name || "Discord user";
  return [name, "signed in with Discord"];
}

/** One part per line on phones, so the line count (and the loading outline) doesn't depend on wrapping. */
function Subline({ parts }: { parts: ReactNode[] }) {
  return (
    <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
      {parts.map((part, i) => (
        <span key={i} className="block sm:inline">
          {i ? <span className="hidden sm:inline"> · </span> : null}
          {part}
        </span>
      ))}
    </p>
  );
}

/**
 * Profile: the player's characters, skins, drinks and custom items, and the accounts linked to them.
 * A Discord sign-in with a linked Minecraft account opens it; an in-game code opens it without Discord.
 */
export default function ProfilePanel({
  tab: initialTab = null,
  signin = null,
  minecraft: minecraftStatus = null,
  shape = DEFAULT_ACCOUNT_SHAPE,
}: {
  tab?: ProfileTab | null;
  signin?: string | null;
  minecraft?: string | null;
  /** What the page drew last time, for the loading outline. */
  shape?: AccountShape;
}) {
  const uiDev = isCharacterUiDev();
  const [load, setLoad] = useState<Load>(uiDev ? { kind: "signed_out" } : { kind: "loading" });
  const [session, setSessionState] = useState<ProfileSession | null>(uiDev ? uiDevSession() : null);
  const [sessionChecked, setSessionChecked] = useState(uiDev);
  // Bumped once when the server refuses a stored Discord session, so a fresh one is asked for.
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const sessionRetried = useRef(false);
  const [dashboard, setDashboard] = useState<ProfileDashboard | null>(uiDev ? uiDevDashboard() : null);
  const [dashboardFor, setDashboardFor] = useState<string | null>(uiDev ? UI_DEV_SESSION_TOKEN : null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [overviewFor, setOverviewFor] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [tab, setTab] = useState<ProfileTab | null>(initialTab);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const codeId = useId();
  const panelId = useId();
  const notice = signInMessage(signin) || minecraftLinkMessage(minecraftStatus);

  const refresh = useCallback(async () => {
    try {
      const account = await getAccount();
      setLoad(account ? { kind: "ready", account } : { kind: "signed_out" });
    } catch (err) {
      setLoad(err instanceof AccountApiError && err.status === 503 ? { kind: "unavailable" } : { kind: "error" });
    }
  }, []);

  useEffect(() => {
    if (!uiDev) void refresh();
  }, [refresh, uiDev]);

  const playerUuid = load.kind === "ready" ? load.account.minecraft?.player_uuid ?? null : null;

  // A linked Minecraft account opens Profile; otherwise an in-game code session kept from before.
  useEffect(() => {
    if (uiDev || load.kind === "loading") return;
    let live = true;
    if (playerUuid) {
      linkedProfileSession(playerUuid)
        .then((next) => live && setSessionState(next))
        .catch(() => live && setSessionState(null))
        .finally(() => live && setSessionChecked(true));
    } else {
      const existing = getSession();
      if (existing && !isSessionValid(existing)) clearSession();
      setSessionState(isSessionValid(existing) ? existing : null);
      setSessionChecked(true);
    }
    return () => {
      live = false;
    };
  }, [load.kind, playerUuid, sessionAttempt, uiDev]);

  const loadDashboard = useCallback(
    async (token: string, opts?: { quiet?: boolean }) => {
      if (uiDev) return;
      if (!opts?.quiet) setLoadingDashboard(true);
      setLoadError(null);
      try {
        setDashboard(await getProfileDashboard(token));
      } catch (err) {
        if (err instanceof ProfileApiError && err.status === 401) {
          const stored = getSession();
          const linked = stored?.source === "discord" && stored.session_token === token;
          clearSession();
          setSessionState(null);
          setDashboard(null);
          if (linked && !sessionRetried.current) {
            sessionRetried.current = true;
            setSessionChecked(false);
            setSessionAttempt((n) => n + 1);
          }
        } else {
          setLoadError(err instanceof Error ? err.message : "Could not load profile");
        }
      } finally {
        if (!opts?.quiet) setLoadingDashboard(false);
        setDashboardFor(token);
      }
    },
    [uiDev]
  );

  const token = session?.session_token ?? null;
  useEffect(() => {
    if (uiDev) return;
    setDashboard(null);
    if (token) void loadDashboard(token);
  }, [loadDashboard, token, uiDev]);

  useEffect(() => {
    if (uiDev || !token || !hasPending(dashboard)) return;
    const id = window.setInterval(() => void loadDashboard(token, { quiet: true }), PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [dashboard, loadDashboard, token, uiDev]);

  // The linked player's rank and time on the server. Both are optional.
  useEffect(() => {
    setOverview(null);
    if (!playerUuid) return;
    let live = true;
    getAccountOverview()
      .then((next) => live && setOverview(next))
      .catch(() => undefined)
      .finally(() => live && setOverviewFor(playerUuid));
    return () => {
      live = false;
    };
  }, [playerUuid]);

  // The first view waits for the activity line and Profile so the page doesn't shift as each one arrives.
  const settled =
    load.kind !== "loading" &&
    sessionChecked &&
    (!token || dashboardFor === token) &&
    (!playerUuid || overviewFor === playerUuid);
  const holding = !revealed && !settled;
  useEffect(() => {
    if (!holding) setRevealed(true);
  }, [holding]);
  useEffect(() => {
    if (!holding || load.kind === "loading") return;
    const timer = setTimeout(() => setRevealed(true), EXTRAS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [holding, load.kind]);

  const account = load.kind === "ready" ? load.account : null;
  // Profile's own tabs show while a linked account's session is still on its way.
  const contentTabs = Boolean(session) || (playerUuid !== null && !sessionChecked);
  const tabs = contentTabs ? [...CONTENT_TABS, ACCOUNTS_TAB] : [ACCOUNTS_TAB];
  const shown: ProfileTab = tabs.some(([id]) => id === tab) ? tab! : tabs[0][0];

  const cardRef = useRef<HTMLUListElement>(null);
  const drawn = holding ? null : drawnShape(load, overview, contentTabs);
  useEffect(() => {
    const cardHeight = cardRef.current?.getBoundingClientRect().height || shape.cardHeight;
    if (drawn) rememberAccountShape(cardHeight ? { ...drawn, cardHeight } : drawn);
    // The encoded shape is the dependency, so an unchanged page doesn't rewrite the cookie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn && encodeAccountShape(drawn), shown]);

  function chooseTab(id: ProfileTab) {
    setTab(id);
    // Back from an upload page lands on the same tab.
    window.history.replaceState(null, "", id === "characters" ? "/profile" : `/profile?tab=${id}`);
  }

  function onRedeemed(next: ProfileSession) {
    setSessionState(next);
  }

  /** Ends a code session. Discord sessions end with Sign out under Linked accounts. */
  async function onLogout() {
    if (!session) return;
    if (uiDev) {
      setSessionState(null);
      setDashboard(null);
      return;
    }
    setLoggingOut(true);
    try {
      await logoutProfile(session.session_token);
    } catch {
      // still clear locally
    }
    clearSession();
    setSessionState(null);
    setLoggingOut(false);
  }

  if (holding) return <ProfilePlaceholder shape={shape} tab={initialTab} />;

  if (!account && !session) {
    // Without Discord sign-in the code is the only way in, so it shows open.
    const codeOpen = showCode || load.kind !== "signed_out";
    return (
      <>
        <h1 className={titleClass}>Profile</h1>
        {load.kind === "unavailable" ? (
          <p className="mt-2 text-sm text-[var(--tfmc-mist)]">Discord sign-in isn’t available yet.</p>
        ) : null}
        {load.kind === "error" ? (
          <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
            We couldn’t load your account just now. Please refresh the page.
          </p>
        ) : null}
        {load.kind === "signed_out" ? (
          <>
            <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
              Sign in with Discord to see your characters, skins and drinks, and the accounts linked to you.
            </p>
            {notice ? (
              <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
                {notice}
              </p>
            ) : null}
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <DiscordSignInLink href={discordSignInUrl(tab ? `/profile?tab=${tab}` : "/profile")} />
              <button
                type="button"
                onClick={() => setShowCode((open) => !open)}
                aria-expanded={showCode}
                aria-controls={codeId}
                className={quietButtonClass}
              >
                Use a code
              </button>
            </div>
          </>
        ) : null}
        <div id={codeId} hidden={!codeOpen} className="mt-8 max-w-md">
          <p className="text-sm text-[var(--tfmc-mist)]">
            Run <code className="text-[var(--tfmc-accent)]">/token create profile</code> in game, then enter the code.
          </p>
          <ProfileRedeemForm onRedeemed={onRedeemed} variant="compact" />
        </div>
      </>
    );
  }

  const minecraft = account?.minecraft ?? null;
  const subline = account ? sublineParts(account, overview) : [];
  const aliveCount = (dashboard?.characters || []).filter((c) => String(c.status).toUpperCase() === "ALIVE").length;
  const codeSession = session && session.source !== "discord" ? session : null;

  return (
    <>
      {account ? (
        <header className="flex items-center gap-5">
          {minecraft ? (
            <PlayerHead key={minecraft.player_uuid} uuid={minecraft.player_uuid} fallback={account.user.avatar_url} />
          ) : (
            /* Discord's CDN serves the avatar; next/image would need a remote pattern for one small image. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={account.user.avatar_url} alt="" width={72} height={72} className="h-[72px] w-[72px] shrink-0 rounded-full" />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">Profile</p>
            <h1 className={`${titleClass} truncate`}>
              {minecraft?.minecraft_name || account.user.discord_global_name || account.user.discord_username || "Discord user"}
            </h1>
            {subline.length ? <Subline parts={subline} /> : null}
            {minecraft && (overview?.rank || account.patreon?.tier_name) ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {overview?.rank ? (
                  <span className={`${chipClass} border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] text-[var(--tfmc-accent)]`}>
                    {overview.rank}
                  </span>
                ) : null}
                {account.patreon?.tier_name ? (
                  <span className={`${chipClass} border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] text-[var(--tfmc-stone)]`}>
                    {account.patreon.tier_name} supporter
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
      ) : (
        <div className="flex items-baseline gap-3">
          <h1 className={titleClass}>Profile</h1>
          {uiDev ? (
            <span className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
              UI-dev
            </span>
          ) : null}
        </div>
      )}

      {codeSession ? (
        <p className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--tfmc-mist)]">
          <span>Opened with an in-game code.</span>
          <button type="button" onClick={() => void onLogout()} disabled={loggingOut} className={quietButtonClass}>
            {loggingOut ? "Logging out…" : "Log out"}
          </button>
        </p>
      ) : null}

      {actionError || notice ? (
        <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
          {actionError || notice}
        </p>
      ) : null}
      {minecraftStatus === "linked" && minecraft ? (
        <p className="mt-6 text-sm text-[var(--tfmc-accent)]" role="status">
          Linked {minecraft.minecraft_name || "your Minecraft account"} with Microsoft.
        </p>
      ) : null}
      {minecraft?.in_grace ? (
        <p className={`${cardClass} mt-6 p-4 text-sm text-[#e8c9a0]`} role="status">
          You’ve left the TFMC Discord. Rejoin before {formatDeadline(minecraft.grace_until)} or your Minecraft
          account will be unlinked.
        </p>
      ) : null}

      {tabs.length > 1 ? (
        <div className={tabBarClass} role="tablist" aria-label="Profile sections">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              id={`${panelId}-${id}`}
              type="button"
              role="tab"
              onClick={() => chooseTab(id)}
              aria-selected={shown === id}
              aria-controls={panelId}
              className={`${tabClass} ${shown === id ? activeTabClass : idleTabClass}`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <h2 className={`${sectionHeadingClass} mt-8 mb-3`}>Linked accounts</h2>
      )}

      <div
        id={panelId}
        role={tabs.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={tabs.length > 1 ? `${panelId}-${shown}` : undefined}
        className={tabs.length > 1 ? "mt-6" : undefined}
      >
        {shown === "accounts" ? (
          account ? (
            <LinkedAccounts
              account={account}
              initialRecheck={minecraftStatus === "guild_check_stale"}
              cardRef={cardRef}
              refresh={refresh}
              onLoad={setLoad}
              onError={setActionError}
            />
          ) : (
            <>
              <p className="text-sm text-[var(--tfmc-mist)]">
                Sign in with Discord to link your Minecraft and Patreon accounts, so Profile opens without a code.
              </p>
              {load.kind === "signed_out" ? (
                <div className="mt-6 flex">
                  <DiscordSignInLink href={discordSignInUrl(ACCOUNTS_PATH)} />
                </div>
              ) : null}
            </>
          )
        ) : (
          <>
            {loadError ? <p className="mb-4 text-sm text-[#e8a0a0]">{loadError}</p> : null}
            {!dashboard ? (
              loadingDashboard || !sessionChecked ? <p className="text-sm text-[var(--tfmc-mist)]">Loading…</p> : null
            ) : shown === "characters" ? (
              <CharacterList
                characters={dashboard.characters}
                aliveCount={aliveCount}
                maxSlots={dashboard.max_alive_characters ?? 3}
                onRefresh={() => token && void loadDashboard(token)}
                refreshing={loadingDashboard}
              />
            ) : shown === "skins" ? (
              <SkinWardrobe rows={dashboard.skins} allowance={dashboard.can_start?.skin} sessionToken={token!} />
            ) : shown === "drinks" ? (
              <DrinkWardrobe rows={dashboard.drinks} allowance={dashboard.can_start?.drink} sessionToken={token!} />
            ) : (
              <ProfileCustomItemsList items={dashboard.custom_items} />
            )}
          </>
        )}
      </div>
    </>
  );
}

/** The parts the page shows for this state, matching the render above. */
function drawnShape(load: Load, overview: AccountOverview | null, contentTabs: boolean): AccountShape | null {
  if (load.kind !== "ready") return { ...DEFAULT_ACCOUNT_SHAPE, signedIn: false, tabs: contentTabs };
  const { minecraft, patreon } = load.account;
  return {
    signedIn: true,
    subline: Math.min(sublineParts(load.account, overview).length, 2) as AccountShape["subline"],
    chips: Boolean(minecraft && (overview?.rank || patreon?.tier_name)),
    tabs: contentTabs,
    rows: patreon ? 3 : 2,
  };
}

/** The page's outline, sized to its lines and shaped like last time, so nothing moves when the account arrives. */
function ProfilePlaceholder({ shape, tab }: { shape: AccountShape; tab: ProfileTab | null }) {
  const bar = (className: string, round = "rounded-sm") => (
    <span className={`${placeholderClass} block ${round} ${className}`} />
  );
  if (!shape.signedIn) {
    return (
      <div aria-busy="true">
        <h1 className={titleClass}>Profile</h1>
        <p className="sr-only">Loading your profile…</p>
      </div>
    );
  }
  const tabs = shape.tabs ? [...CONTENT_TABS, ACCOUNTS_TAB] : [ACCOUNTS_TAB];
  const shown = tabs.some(([id]) => id === tab) ? tab : tabs[0][0];
  return (
    <div aria-busy="true">
      <p className="sr-only">Loading your profile…</p>
      <div aria-hidden className="animate-pulse">
        <div className="flex items-center gap-5">
          {bar("h-[72px] w-[72px] shrink-0")}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">Profile</p>
            <span className="flex h-9 items-center sm:h-10">{bar("h-7 w-56 max-w-full sm:h-8")}</span>
            {shape.subline ? (
              <span className="mt-1 block">
                <span className="flex h-5 items-center">{bar("h-3.5 w-72 max-w-full")}</span>
                {shape.subline > 1 ? <span className="flex h-5 items-center sm:hidden">{bar("h-3.5 w-48")}</span> : null}
              </span>
            ) : null}
            {shape.chips ? bar("mt-2 h-[22.5px] w-16") : null}
          </div>
        </div>
        {tabs.length > 1 ? (
          <div className={tabBarClass}>
            {tabs.map(([id, label]) => (
              <span key={id} className={`${tabClass} ${shown === id ? activeTabClass : idleTabClass}`}>
                {label}
              </span>
            ))}
          </div>
        ) : (
          <p className={`${sectionHeadingClass} mt-8 mb-3`}>Linked accounts</p>
        )}
        {shown === "accounts" ? (
          <div
            className={`${cardClass} ${tabs.length > 1 ? "mt-6" : ""} divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] overflow-hidden`}
            style={shape.cardHeight ? { height: shape.cardHeight } : undefined}
          >
            {["Discord", "Minecraft", "Patreon"].slice(0, shape.rows).map((service) => (
              <div key={service} className="flex items-center gap-4 px-4 py-3.5">
                {bar("h-8 w-8 shrink-0", "rounded-full")}
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">{service}</p>
                  <span className="flex h-6 items-center">{bar("h-4 w-40 max-w-full")}</span>
                  <span className="flex h-5 items-center">{bar("h-3.5 w-56 max-w-full")}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

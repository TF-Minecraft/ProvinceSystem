"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  discordSignInUrl,
  getAccount,
  getAccountOverview,
  isNotGuildMember,
  minecraftHeadUrl,
  minecraftLinkMessage,
  needsGuildRecheck,
  signInMessage,
  signOut,
  startAccountPatreonLink,
  startMicrosoftLink,
  unlinkAccountPatreon,
  unlinkMinecraft,
  AccountApiError,
  type Account,
  type AccountMinecraft,
  type AccountOverview,
} from "../../../lib/account/api";
import { endLinkedProfileSession, linkedProfileSession } from "../../../lib/account/profileSession";
import { getProfileDashboard, type ProfileDashboard } from "../../../lib/profile/api";
import type { PatreonStatus } from "../../../lib/profile/patreon";
import { SITE_DISCORD_URL } from "../../../lib/site/config";
import { DiscordSignInLink, MicrosoftSignInButton, PatreonConnectButton } from "./BrandButtons";
import MinecraftLinkForm from "./MinecraftLinkForm";

const PATREON_URL = "https://www.patreon.com/c/tfmcrp";

const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
const quietButtonClass =
  "text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";
const accentLinkClass = "text-[var(--tfmc-accent)] underline-offset-2 hover:underline";
const cardClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)]";
const sectionHeadingClass = "font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]";
const titleClass = "font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl";
const chipClass = "rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider";
const placeholderClass = "rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]";

/** Longest the page waits for the activity line and Profile counts before showing without them. */
const EXTRAS_WAIT_MS = 2500;

type Load =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; account: Account };

function formatDate(value: string | number | null | undefined): string {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}

/** Grace lasts about an hour, so the deadline needs a time and zone. */
function formatDeadline(value: string | null | undefined): string {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "the deadline";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
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

function activityLine(overview: AccountOverview | null): ReactNode {
  const activity = overview?.activity;
  if (!activity) return null;
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
    parts.push(<span key="seen">Last on{where} {formatAgo(activity.last_seen)}</span>);
  }
  if (activity.first_seen) parts.push(<span key="since">playing since {formatDate(activity.first_seen)}</span>);
  if (!parts.length) return null;
  return parts.flatMap((part, i) => (i ? [" · ", part] : [part]));
}

function linkedHow(minecraft: AccountMinecraft): string {
  const date = formatDate(minecraft.linked_at);
  const how =
    minecraft.link_method === "microsoft"
      ? "Linked with Microsoft"
      : minecraft.link_method === "code"
        ? "Linked with an in-game code"
        : "Linked";
  return date ? `${how} · ${date}` : how;
}

export default function AccountPanel({
  signin,
  minecraft: minecraftStatus = null,
}: {
  signin: string | null;
  minecraft?: string | null;
}) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [dashboard, setDashboard] = useState<ProfileDashboard | null>(null);
  const [extrasFor, setExtrasFor] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmPatreon, setConfirmPatreon] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(minecraftStatus === "guild_check_stale");
  const [showCode, setShowCode] = useState(false);
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
    void refresh();
  }, [refresh]);

  const playerUuid = load.kind === "ready" ? load.account.minecraft?.player_uuid ?? null : null;

  // The linked player's rank, time on the server and Profile counts. Each is optional.
  useEffect(() => {
    setOverview(null);
    setDashboard(null);
    if (!playerUuid) return;
    let live = true;
    const overviewDone = getAccountOverview()
      .then((next) => live && setOverview(next))
      .catch(() => undefined);
    const dashboardDone = linkedProfileSession(playerUuid)
      .then((session) => getProfileDashboard(session.session_token))
      .then((next) => live && setDashboard(next))
      .catch(() => undefined);
    void Promise.all([overviewDone, dashboardDone]).then(() => live && setExtrasFor(playerUuid));
    return () => {
      live = false;
    };
  }, [playerUuid]);

  // The first view waits for the extras so the page doesn't shift as each one arrives.
  const holding =
    !revealed && (load.kind === "loading" || (playerUuid !== null && extrasFor !== playerUuid));
  useEffect(() => {
    if (!holding) setRevealed(true);
  }, [holding]);
  useEffect(() => {
    if (!holding || load.kind === "loading") return;
    const timer = setTimeout(() => setRevealed(true), EXTRAS_WAIT_MS);
    return () => clearTimeout(timer);
  }, [holding, load.kind]);

  async function onSignOut() {
    setBusy(true);
    setActionError(null);
    let failed = false;
    try {
      await signOut();
    } catch {
      failed = true;
    }
    if (!failed) await endLinkedProfileSession();
    // The cookie may already be gone, so reload state either way.
    let account: Account | null;
    try {
      account = await getAccount();
    } catch {
      setLoad({ kind: "error" });
      setBusy(false);
      return;
    }
    if (failed && !account) await endLinkedProfileSession();
    setLoad(account ? { kind: "ready", account } : { kind: "signed_out" });
    if (failed && account) {
      setActionError("We couldn’t sign you out just now. Please try again.");
    }
    setBusy(false);
  }

  async function onUnlink() {
    setBusy(true);
    setActionError(null);
    try {
      await unlinkMinecraft();
      await endLinkedProfileSession();
      setConfirmUnlink(false);
      await refresh();
    } catch {
      setActionError("We couldn’t unlink your Minecraft account just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onConnectMicrosoft() {
    setBusy(true);
    setActionError(null);
    try {
      window.location.assign(await startMicrosoftLink());
    } catch (err) {
      if (needsGuildRecheck(err)) {
        setRecheck(true);
      } else if (isNotGuildMember(err)) {
        setActionError("Linking needs you to be in the TFMC Discord server.");
      } else if (err instanceof AccountApiError && err.status === 409) {
        await refresh();
      } else if (err instanceof AccountApiError && err.status === 429) {
        setActionError(err.message);
      } else {
        setActionError("We couldn’t open Microsoft sign-in just now. Please try again.");
      }
      setBusy(false);
    }
  }

  async function onRecheckGuild() {
    setBusy(true);
    setActionError(null);
    setRecheck(false);
    try {
      const account = await getAccount();
      setLoad(account ? { kind: "ready", account } : { kind: "signed_out" });
      if (account && !account.guild.member) {
        setActionError("Discord doesn’t show you in the TFMC server yet. Try again in a moment.");
      }
    } catch {
      setActionError("We couldn’t check with Discord just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onConnectPatreon() {
    setBusy(true);
    setActionError(null);
    try {
      window.location.assign(await startAccountPatreonLink());
    } catch {
      setActionError("We couldn’t open Patreon just now. Please try again.");
      setBusy(false);
    }
  }

  async function onDisconnectPatreon() {
    setBusy(true);
    setActionError(null);
    try {
      await unlinkAccountPatreon();
      setConfirmPatreon(false);
      await refresh();
    } catch {
      setActionError("We couldn’t disconnect Patreon just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (holding) return <AccountPlaceholder />;

  if (load.kind !== "ready") {
    return (
      <>
        <h1 className={titleClass}>Account</h1>
        {load.kind === "unavailable" ? (
          <p className="mt-6 text-[var(--tfmc-mist)]">Discord sign-in isn’t available yet.</p>
        ) : null}
        {load.kind === "error" ? (
          <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
            We couldn’t load your account just now. Please refresh the page.
          </p>
        ) : null}
        {load.kind === "signed_out" ? (
          <>
            <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
              Sign in with Discord to see your characters, skins and drinks, and the Minecraft and Patreon
              accounts linked to you.
            </p>
            {notice ? (
              <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
                {notice}
              </p>
            ) : null}
            <div className="mt-8 flex">
              <DiscordSignInLink href={discordSignInUrl("/account")} />
            </div>
          </>
        ) : null}
      </>
    );
  }

  const { account } = load;
  const { user, guild, minecraft, patreon } = account;
  const displayName = user.discord_global_name || user.discord_username || "Discord user";
  const discordHandle = user.discord_username ? `@${user.discord_username}` : displayName;
  const subline = minecraft ? activityLine(overview) : `${discordHandle} · signed in with Discord`;

  return (
    <>
      <header className="flex items-center gap-5">
        {minecraft ? (
          <PlayerHead key={minecraft.player_uuid} uuid={minecraft.player_uuid} fallback={user.avatar_url} />
        ) : (
          /* Discord's CDN serves the avatar; next/image would need a remote pattern for one small image. */
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={user.avatar_url} alt="" width={72} height={72} className="h-[72px] w-[72px] shrink-0 rounded-full" />
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">Account</p>
          <h1 className={`${titleClass} truncate`}>{minecraft?.minecraft_name || displayName}</h1>
          {subline ? <p className="mt-1 text-sm text-[var(--tfmc-mist)]">{subline}</p> : null}
          {minecraft && (overview?.rank || patreon?.tier_name) ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {overview?.rank ? (
                <span className={`${chipClass} border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] text-[var(--tfmc-accent)]`}>
                  {overview.rank}
                </span>
              ) : null}
              {patreon?.tier_name ? (
                <span className={`${chipClass} border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] text-[var(--tfmc-stone)]`}>
                  {patreon.tier_name} supporter
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

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

      {minecraft && dashboard ? <ProfileTiles dashboard={dashboard} /> : null}

      <section className="mt-8" aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className={`${sectionHeadingClass} mb-3`}>
          Linked accounts
        </h2>
        <ul
          className={`${cardClass} divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]`}
          aria-label="Connected accounts"
        >
          <AccountRow
            label="Discord account"
            service="Discord"
            icon={
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={user.avatar_url} alt="" width={32} height={32} className="h-8 w-8 rounded-full" />
            }
            action={
              <button type="button" onClick={() => void onSignOut()} disabled={busy} className={quietButtonClass}>
                Sign out
              </button>
            }
          >
            <p className="truncate font-semibold text-[var(--tfmc-cream)]">{displayName}</p>
            {user.discord_username ? (
              <p className="truncate text-sm text-[var(--tfmc-stone)]">@{user.discord_username}</p>
            ) : null}
          </AccountRow>

          <AccountRow
            label="Minecraft account"
            service="Minecraft"
            icon={minecraft ? <PlayerHead uuid={minecraft.player_uuid} fallback={null} size={32} /> : <EmptyIcon />}
            action={
              minecraft ? (
                confirmUnlink ? null : (
                  <button type="button" onClick={() => setConfirmUnlink(true)} className={quietButtonClass}>
                    Unlink
                  </button>
                )
              ) : (
                <LinkActions
                  account={account}
                  recheck={recheck}
                  busy={busy}
                  showCode={showCode}
                  onConnectMicrosoft={() => void onConnectMicrosoft()}
                  onToggleCode={() => setShowCode((open) => !open)}
                  onRecheck={() => void onRecheckGuild()}
                />
              )
            }
            below={
              !minecraft && account.guild.member && !recheck ? (
                <MinecraftLinkForm discordName={discordHandle} onLinked={refresh} />
              ) : null
            }
            // Hidden rather than unmounted, so closing it mid-request keeps the request's outcome.
            belowOpen={showCode}
          >
            {minecraft ? (
              <>
                <p className="truncate font-semibold text-[var(--tfmc-cream)]">
                  {minecraft.minecraft_name || "Minecraft account"}
                </p>
                <p className="text-sm text-[var(--tfmc-stone)]">{linkedHow(minecraft)}</p>
                {confirmUnlink ? (
                  <div className="mt-3 flex flex-wrap items-center gap-4">
                    <span className="text-sm text-[var(--tfmc-mist)]">Unlink this Minecraft account?</span>
                    <button type="button" onClick={() => void onUnlink()} disabled={busy} className={buttonClass}>
                      Unlink
                    </button>
                    <button type="button" onClick={() => setConfirmUnlink(false)} disabled={busy} className={quietButtonClass}>
                      Keep it
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-[var(--tfmc-stone)]">Not linked</p>
                {!account.guild.member ? (
                  <p className="text-sm text-[var(--tfmc-stone)]">
                    Join the{" "}
                    <a href={SITE_DISCORD_URL} className={accentLinkClass}>
                      TFMC Discord
                    </a>{" "}
                    to link.
                  </p>
                ) : recheck ? (
                  <p className="text-sm text-[var(--tfmc-stone)]">Confirm your Discord membership to link.</p>
                ) : null}
              </>
            )}
          </AccountRow>

          {patreon ? (
            <PatreonRow
              patreon={patreon}
              busy={busy}
              confirm={confirmPatreon}
              onConnect={() => void onConnectPatreon()}
              onBegin={() => setConfirmPatreon(true)}
              onCancel={() => setConfirmPatreon(false)}
              onDisconnect={() => void onDisconnectPatreon()}
            />
          ) : null}
        </ul>
      </section>

    </>
  );
}

/** The signed-in layout's outline, sized to its lines, so the page keeps its shape when the account arrives. */
function AccountPlaceholder() {
  const bar = (className: string) => <span className={`${placeholderClass} block ${className}`} />;
  return (
    <div aria-busy="true">
      <p className="sr-only">Loading your account…</p>
      <div aria-hidden className="animate-pulse">
        <div className="flex items-center gap-5">
          {bar("h-[72px] w-[72px] shrink-0")}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">Account</p>
            <span className="flex h-9 items-center sm:h-10">{bar("h-7 w-56 max-w-full sm:h-8")}</span>
            <span className="mt-1 flex h-5 items-center">{bar("h-3.5 w-72 max-w-full")}</span>
            {bar("mt-2 h-[22px] w-16")}
          </div>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={`${cardClass} block h-[78px]`} />
          ))}
        </div>
        <p className={`${sectionHeadingClass} mt-8 mb-3`}>Linked accounts</p>
        <div className={`${cardClass} divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]`}>
          {["Discord", "Minecraft", "Patreon"].map((service) => (
            <div key={service} className="flex items-center gap-4 px-4 py-3.5">
              {bar("h-8 w-8 shrink-0 rounded-full")}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">{service}</p>
                <span className="flex h-6 items-center">{bar("h-4 w-40 max-w-full")}</span>
                <span className="flex h-5 items-center">{bar("h-3.5 w-56 max-w-full")}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerHead({ uuid, fallback, size = 72 }: { uuid: string; fallback: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = size === 72 ? "h-[72px] w-[72px]" : "h-8 w-8";
  if (failed) {
    return fallback ? (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img src={fallback} alt="" width={size} height={size} className={`${box} shrink-0 rounded-full`} />
    ) : (
      <EmptyIcon />
    );
  }
  return (
    /* Our API serves this head, so the player's browser never asks Mojang. */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`${minecraftHeadUrl()}?u=${encodeURIComponent(uuid)}`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`${box} shrink-0 rounded-[3px] shadow-[0_0_0_1px_color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] [image-rendering:pixelated]`}
    />
  );
}

function EmptyIcon() {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] text-[var(--tfmc-stone)]"
    >
      –
    </span>
  );
}

function AccountRow({
  label,
  service,
  icon,
  action,
  below,
  belowOpen = true,
  children,
}: {
  label: string;
  service: string;
  icon: ReactNode;
  action?: ReactNode;
  /** Full-width content under the row, such as a form. */
  below?: ReactNode;
  belowOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <li
      aria-label={label}
      className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5"
    >
      <span className="flex shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">{service}</p>
        {children}
      </div>
      {action ? (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-3">{action}</div>
      ) : null}
      {below ? (
        <div hidden={!belowOpen} className="basis-full sm:pl-12">
          {below}
        </div>
      ) : null}
    </li>
  );
}

function PatreonRow({
  patreon,
  busy,
  confirm,
  onConnect,
  onBegin,
  onCancel,
  onDisconnect,
}: {
  patreon: PatreonStatus;
  busy: boolean;
  confirm: boolean;
  onConnect: () => void;
  onBegin: () => void;
  onCancel: () => void;
  onDisconnect: () => void;
}) {
  const icon = (
    <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/patreon-symbol-white.svg" alt="" width={14} height={14} />
    </span>
  );
  if (!patreon.linked) {
    return (
      <AccountRow label="Patreon" service="Patreon" icon={<EmptyIcon />} action={
        <PatreonConnectButton onClick={onConnect} disabled={busy} />
      }>
        <p className="text-[var(--tfmc-stone)]">Not connected</p>
      </AccountRow>
    );
  }
  const tier = patreon.tier_name;
  return (
    <AccountRow
      label="Patreon"
      service="Patreon"
      icon={icon}
      action={
        confirm ? null : (
          <>
            {!tier ? (
              <a href={PATREON_URL} target="_blank" rel="noopener noreferrer" className={`text-sm ${accentLinkClass}`}>
                Become a supporter <ExternalArrow />
              </a>
            ) : null}
            <button type="button" onClick={onBegin} className={quietButtonClass}>
              Disconnect
            </button>
          </>
        )
      }
    >
      <p className="font-semibold text-[var(--tfmc-cream)]">
        {tier ? <>Supporting as {tier}. Thank you!</> : "No active tier"}
      </p>
      <p className="text-sm text-[var(--tfmc-stone)]">
        {patreon.grace_until
          ? `Patreon couldn’t take your payment. Perks end on ${formatDate(patreon.grace_until)}.`
          : patreon.is_gifted
            ? "This tier was gifted to you."
            : patreon.patreon_name
              ? `Connected as ${patreon.patreon_name}`
              : "Connected"}
      </p>
      {confirm ? (
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <span className="text-sm text-[var(--tfmc-mist)]">Disconnect Patreon? Your supporter perks will be removed.</span>
          <button type="button" onClick={onDisconnect} disabled={busy} className={buttonClass}>
            Disconnect
          </button>
          <button type="button" onClick={onCancel} disabled={busy} className={quietButtonClass}>
            Keep it
          </button>
        </div>
      ) : null}
    </AccountRow>
  );
}

function LinkActions({
  account,
  recheck,
  busy,
  showCode,
  onConnectMicrosoft,
  onToggleCode,
  onRecheck,
}: {
  account: Account;
  recheck: boolean;
  busy: boolean;
  showCode: boolean;
  onConnectMicrosoft: () => void;
  onToggleCode: () => void;
  onRecheck: () => void;
}) {
  if (!account.guild.member) {
    // Reloading the account asks Discord again, unless the site cannot reach it.
    return account.guild.can_recheck !== true ? (
      <a href={discordSignInUrl("/account")} className={quietButtonClass}>
        I’ve joined, check again
      </a>
    ) : (
      <button type="button" onClick={onRecheck} disabled={busy} className={quietButtonClass}>
        I’ve joined, check again
      </button>
    );
  }
  if (recheck) return <DiscordSignInLink href={discordSignInUrl("/account")} />;
  const codeToggle = (
    <button type="button" onClick={onToggleCode} aria-expanded={showCode} className={quietButtonClass}>
      {account.microsoft_link ? "Use a code" : "Link with a code from in game"}
    </button>
  );
  if (!account.microsoft_link) return codeToggle;
  return (
    <>
      {codeToggle}
      <MicrosoftSignInButton onClick={onConnectMicrosoft} disabled={busy} />
    </>
  );
}

/** A text arrow: the ↗ character turns into an emoji on some systems. */
function ExternalArrow() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" width={10} height={10} className="ml-0.5 inline-block align-baseline">
      <path d="M3.5 2.5h6v6M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

function waiting(count: number): string | null {
  return count ? `${count} waiting` : null;
}

function ProfileTiles({ dashboard }: { dashboard: ProfileDashboard }) {
  const status = (value: unknown) => String(value || "").toLowerCase();
  const alive = dashboard.characters.filter((c) => status(c.status) === "alive").length;
  const tiles: { tab: string; label: string; value: ReactNode; note: string | null }[] = [
    {
      tab: "characters",
      label: "Characters",
      value: (
        <>
          {alive}
          <span className="text-base text-[var(--tfmc-stone)]"> / {dashboard.max_alive_characters ?? 3}</span>
        </>
      ),
      note: waiting(dashboard.characters.filter((c) => status(c.status) === "pending").length),
    },
    {
      tab: "skins",
      label: "Skins",
      value: dashboard.skins.length,
      note: waiting(dashboard.skins.filter((s) => s.status === "pending").length),
    },
    {
      tab: "drinks",
      label: "Drinks",
      value: dashboard.drinks.length,
      note: waiting(dashboard.drinks.filter((d) => d.status === "pending").length),
    },
    {
      tab: "items",
      label: "Custom items",
      value: dashboard.custom_items.length,
      note: waiting(
        dashboard.custom_items.filter(
          (i) => i.state === "pending_skin" || status(i.submission_status) === "pending"
        ).length
      ),
    },
  ];
  return (
    <nav className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-4" aria-label="Your Profile">
      {tiles.map((tile) => (
        <Link
          key={tile.tab}
          href={`/profile?tab=${tile.tab}`}
          className={`${cardClass} block px-4 py-3 transition-colors hover:border-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)]`}
        >
          <span className="block font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
            {tile.value}
          </span>
          <span className="block text-sm text-[var(--tfmc-stone)]">{tile.label}</span>
          {tile.note ? <span className="mt-0.5 block text-xs text-[#e8c9a0]">{tile.note}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

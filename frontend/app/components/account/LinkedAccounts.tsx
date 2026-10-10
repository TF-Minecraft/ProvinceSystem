"use client";

import { useState, type ReactNode, type Ref } from "react";
import {
  discordSignInUrl,
  getAccount,
  isNotGuildMember,
  minecraftHeadUrl,
  needsGuildRecheck,
  signOut,
  startAccountPatreonLink,
  startMicrosoftLink,
  unlinkAccountPatreon,
  unlinkMinecraft,
  AccountApiError,
  type Account,
  type AccountMinecraft,
} from "../../../lib/account/api";
import { endLinkedProfileSession } from "../../../lib/account/profileSession";
import type { PatreonStatus } from "../../../lib/profile/patreon";
import { SITE_DISCORD_URL } from "../../../lib/site/config";
import { DiscordSignInLink, MicrosoftSignInButton, PatreonConnectButton } from "./BrandButtons";
import MinecraftLinkForm from "./MinecraftLinkForm";

const PATREON_URL = "https://www.patreon.com/c/tfmcrp";

/** Where Discord sends someone back to after a fresh sign-in from this card. */
export const ACCOUNTS_PATH = "/profile?tab=accounts";

export const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
export const quietButtonClass =
  "text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";
const accentLinkClass = "text-[var(--tfmc-accent)] underline-offset-2 hover:underline";
export const cardClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)]";

/** The account as the page holds it. */
export type Load =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; account: Account };

export function formatDate(value: string | number | null | undefined): string {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(date);
}

/** Grace lasts about an hour, so the deadline needs a time and zone. */
export function formatDeadline(value: string | null | undefined): string {
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

/** Discord, Minecraft and Patreon in one card, with signing out, linking and unlinking. */
export default function LinkedAccounts({
  account,
  initialRecheck = false,
  cardRef,
  refresh,
  onLoad,
  onError,
}: {
  account: Account;
  /** Linking needs a fresh Discord sign-in first. */
  initialRecheck?: boolean;
  cardRef?: Ref<HTMLUListElement>;
  /** Reloads the account into the page. */
  refresh: () => Promise<void>;
  onLoad: (load: Load) => void;
  /** Shows a failed action's message on the page, or clears it with null. */
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [confirmPatreon, setConfirmPatreon] = useState(false);
  const [recheck, setRecheck] = useState(initialRecheck);
  const [showCode, setShowCode] = useState(false);

  async function onSignOut() {
    setBusy(true);
    onError(null);
    let failed = false;
    try {
      await signOut();
    } catch {
      failed = true;
    }
    if (!failed) await endLinkedProfileSession();
    // The cookie may already be gone, so reload state either way.
    let next: Account | null;
    try {
      next = await getAccount();
    } catch {
      onLoad({ kind: "error" });
      setBusy(false);
      return;
    }
    if (failed && !next) await endLinkedProfileSession();
    onLoad(next ? { kind: "ready", account: next } : { kind: "signed_out" });
    if (failed && next) {
      onError("We couldn’t sign you out just now. Please try again.");
    }
    setBusy(false);
  }

  async function onUnlink() {
    setBusy(true);
    onError(null);
    try {
      await unlinkMinecraft();
      await endLinkedProfileSession();
      setConfirmUnlink(false);
      await refresh();
    } catch {
      onError("We couldn’t unlink your Minecraft account just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onConnectMicrosoft() {
    setBusy(true);
    onError(null);
    try {
      window.location.assign(await startMicrosoftLink());
    } catch (err) {
      if (needsGuildRecheck(err)) {
        setRecheck(true);
      } else if (isNotGuildMember(err)) {
        onError("Linking needs you to be in the TFMC Discord server.");
      } else if (err instanceof AccountApiError && err.status === 409) {
        await refresh();
      } else if (err instanceof AccountApiError && err.status === 429) {
        onError(err.message);
      } else {
        onError("We couldn’t open Microsoft sign-in just now. Please try again.");
      }
      setBusy(false);
    }
  }

  async function onRecheckGuild() {
    setBusy(true);
    onError(null);
    setRecheck(false);
    try {
      const next = await getAccount();
      onLoad(next ? { kind: "ready", account: next } : { kind: "signed_out" });
      if (next && !next.guild.member) {
        onError("Discord doesn’t show you in the TFMC server yet. Try again in a moment.");
      }
    } catch {
      onError("We couldn’t check with Discord just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onConnectPatreon() {
    setBusy(true);
    onError(null);
    try {
      window.location.assign(await startAccountPatreonLink());
    } catch {
      onError("We couldn’t open Patreon just now. Please try again.");
      setBusy(false);
    }
  }

  async function onDisconnectPatreon() {
    setBusy(true);
    onError(null);
    try {
      await unlinkAccountPatreon();
      setConfirmPatreon(false);
      await refresh();
    } catch {
      onError("We couldn’t disconnect Patreon just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const { user, minecraft, patreon } = account;
  const displayName = user.discord_global_name || user.discord_username || "Discord user";
  const discordHandle = user.discord_username ? `@${user.discord_username}` : displayName;

  return (
    <ul
      ref={cardRef}
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
  );
}

export function PlayerHead({ uuid, fallback, size = 72 }: { uuid: string; fallback: string | null; size?: number }) {
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
      <a href={discordSignInUrl(ACCOUNTS_PATH)} className={quietButtonClass}>
        I’ve joined, check again
      </a>
    ) : (
      <button type="button" onClick={onRecheck} disabled={busy} className={quietButtonClass}>
        I’ve joined, check again
      </button>
    );
  }
  if (recheck) return <DiscordSignInLink href={discordSignInUrl(ACCOUNTS_PATH)} />;
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

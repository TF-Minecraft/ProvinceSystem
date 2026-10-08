"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  discordSignInUrl,
  getAccount,
  signInMessage,
  signOut,
  startAccountPatreonLink,
  unlinkMinecraft,
  AccountApiError,
  type Account,
} from "../../../lib/account/api";
import { SITE_DISCORD_URL } from "../../../lib/site/config";
import MinecraftLinkForm from "./MinecraftLinkForm";

const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
const quietButtonClass =
  "text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";
const rowClass =
  "flex gap-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-5";
const headingClass = "font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]";

type Load =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "unavailable" }
  | { kind: "error" }
  | { kind: "ready"; account: Account };

function formatDate(value: string | null | undefined): string {
  const date = new Date(value || "");
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

export default function AccountPanel({ signin }: { signin: string | null }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const notice = signInMessage(signin);

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

  async function onSignOut() {
    setBusy(true);
    setActionError(null);
    let failed = false;
    try {
      await signOut();
    } catch {
      failed = true;
    }
    // The cookie may already be gone, so reload state either way.
    let account: Account | null;
    try {
      account = await getAccount();
    } catch {
      setLoad({ kind: "error" });
      setBusy(false);
      return;
    }
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
      setConfirmUnlink(false);
      await refresh();
    } catch {
      setActionError("We couldn’t unlink your Minecraft account just now. Please try again.");
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

  if (load.kind === "loading") {
    return <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>;
  }
  if (load.kind === "unavailable") {
    return <p className="mt-6 text-[var(--tfmc-mist)]">Discord sign-in isn’t available yet.</p>;
  }
  if (load.kind === "error") {
    return (
      <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
        We couldn’t load your account just now. Please refresh the page.
      </p>
    );
  }
  if (load.kind === "signed_out") {
    return (
      <>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          Sign in with Discord to see the Minecraft and Patreon accounts linked to you.
        </p>
        {notice ? (
          <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
            {notice}
          </p>
        ) : null}
        <a href={discordSignInUrl("/account")} className={`${buttonClass} mt-8 self-start`}>
          Sign in with Discord
        </a>
      </>
    );
  }

  const { account } = load;
  const { user, guild, minecraft, patreon } = account;
  const displayName = user.discord_global_name || user.discord_username || "Discord user";
  const discordHandle = user.discord_username ? `@${user.discord_username}` : displayName;

  return (
    <>
      {actionError || notice ? (
        <p className="mt-4 text-sm text-[#e8a0a0]" role="alert">
          {actionError || notice}
        </p>
      ) : null}

      <ol className="mt-6 flex flex-col gap-4" aria-label="Connected accounts">
        <ConnectionRow step={1} title="Discord" label="Discord account" connected status="Signed in">
          <div className="flex items-center gap-3">
            {/* Discord's CDN serves the avatar; next/image would need a remote pattern for one small image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={user.avatar_url} alt="" width={40} height={40} className="rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-[var(--tfmc-cream)]">{displayName}</p>
              {user.discord_username ? (
                <p className="truncate text-sm text-[var(--tfmc-stone)]">@{user.discord_username}</p>
              ) : null}
            </div>
            <button type="button" onClick={() => void onSignOut()} disabled={busy} className={quietButtonClass}>
              Sign out
            </button>
          </div>
        </ConnectionRow>

        <ConnectionRow
          step={2}
          title="Minecraft"
          label="Minecraft account"
          connected={Boolean(minecraft)}
          status={minecraft ? (minecraft.in_grace ? "Linked, at risk" : "Linked") : "Not linked"}
        >
          {minecraft ? (
            <>
              <p className="text-[var(--tfmc-cream)]">
                <strong>{minecraft.minecraft_name || "Minecraft account"}</strong>
                {formatDate(minecraft.linked_at) ? (
                  <span className="text-[var(--tfmc-stone)]"> · linked {formatDate(minecraft.linked_at)}</span>
                ) : null}
              </p>
              {minecraft.in_grace ? (
                <p className="mt-2 text-sm text-[#e8c9a0]">
                  You’ve left the TFMC Discord. Rejoin before {formatDeadline(minecraft.grace_until)} or this
                  link will be removed.
                </p>
              ) : null}
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
              ) : (
                <button type="button" onClick={() => setConfirmUnlink(true)} className={`${quietButtonClass} mt-3`}>
                  Unlink Minecraft account
                </button>
              )}
            </>
          ) : guild.member ? (
            <MinecraftLinkForm discordName={discordHandle} onLinked={refresh} />
          ) : (
            <>
              <p className="text-sm text-[var(--tfmc-mist)]">
                Linking needs you to be in the TFMC Discord server.{" "}
                <a href={SITE_DISCORD_URL} className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
                  Join it
                </a>
                , then check again.
              </p>
              <a href={discordSignInUrl("/account")} className={`${buttonClass} mt-3`}>
                I’ve joined, check again
              </a>
            </>
          )}
        </ConnectionRow>

        <ConnectionRow
          step={3}
          title="Patreon"
          label="Patreon"
          connected={Boolean(patreon?.linked)}
          status={patreon ? (patreon.linked ? "Connected" : "Not connected") : "Unavailable"}
        >
          {!patreon ? null : patreon.linked ? (
            <p className="text-[var(--tfmc-cream)]">
              {patreon.tier_name ? (
                <>
                  Supporting as <strong>{patreon.tier_name}</strong>. Thank you!
                </>
              ) : (
                "Patreon is connected, with no active tier."
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-[var(--tfmc-mist)]">
                Connect Patreon to receive your supporter perks on Discord and in game.
              </p>
              <button type="button" onClick={() => void onConnectPatreon()} disabled={busy} className={`${buttonClass} mt-3`}>
                Connect Patreon
              </button>
            </>
          )}
        </ConnectionRow>
      </ol>

      <p className="mt-8 text-sm text-[var(--tfmc-stone)]">
        Characters, skins and drinks are on your{" "}
        <Link href="/profile" className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
          Profile
        </Link>
        .
      </p>
    </>
  );
}

function ConnectionRow({
  step,
  title,
  label,
  connected,
  status,
  children,
}: {
  step: number;
  title: string;
  label: string;
  connected: boolean;
  status: string;
  children?: ReactNode;
}) {
  return (
    <li className={rowClass} aria-label={label}>
      <span
        aria-hidden
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          connected
            ? "bg-[var(--tfmc-accent)] text-[var(--tfmc-forest-deep)]"
            : "border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] text-[var(--tfmc-stone)]"
        }`}
      >
        {connected ? "✓" : step}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className={headingClass}>{title}</h2>
          <span className={`text-xs font-semibold uppercase tracking-wider ${connected ? "text-[var(--tfmc-accent)]" : "text-[var(--tfmc-stone)]"}`}>
            {status}
          </span>
        </div>
        {children ? <div className="mt-3">{children}</div> : null}
      </div>
    </li>
  );
}

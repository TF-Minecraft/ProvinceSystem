"use client";

import { FormEvent, useState } from "react";
import {
  discordSignInUrl,
  isNotGuildMember,
  linkMinecraft,
  needsGuildRecheck,
  previewMinecraftLink,
  AccountApiError,
  type MinecraftLinkPreview,
} from "../../../lib/account/api";

const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
const quietButtonClass =
  "text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";

function errorText(err: unknown): string {
  if (isNotGuildMember(err)) return "Linking needs you to be in the TFMC Discord server.";
  if (err instanceof AccountApiError && err.status === 429) return err.message;
  if (err instanceof AccountApiError && err.status === 400) return err.message;
  return "We couldn’t check that code just now. Please try again.";
}

type Props = {
  discordName: string;
  onLinked: () => void | Promise<void>;
};

export default function MinecraftLinkForm({ discordName, onLinked }: Props) {
  const [code, setCode] = useState("");
  const [preview, setPreview] = useState<MinecraftLinkPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recheck, setRecheck] = useState(false);

  async function onCheck(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!code.trim()) {
      setError("Enter the code from /linkdiscord");
      return;
    }
    setBusy(true);
    try {
      setPreview(await previewMinecraftLink(code.trim()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      await linkMinecraft(code.trim());
      await onLinked();
    } catch (err) {
      if (needsGuildRecheck(err)) {
        setRecheck(true);
      } else {
        setError(errorText(err));
        setPreview(null);
      }
      setBusy(false);
    }
  }

  if (recheck) {
    return (
      <>
        <p className="text-sm text-[var(--tfmc-mist)]">
          Please confirm your Discord membership again before linking.
        </p>
        <a href={discordSignInUrl("/profile?tab=accounts")} className={`${buttonClass} mt-4`}>
          Confirm with Discord
        </a>
      </>
    );
  }

  if (preview) {
    return (
      <div>
        <p className="text-[var(--tfmc-cream)]">
          {preview.minecraft_name ? (
            <>
              Link Minecraft account <strong>{preview.minecraft_name}</strong>
            </>
          ) : (
            "Link this Minecraft account"
          )}{" "}
          to Discord <strong>{discordName}</strong>?
        </p>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          Only continue if you ran /linkdiscord yourself. Never enter a code someone else gave you.
        </p>
        {error ? (
          <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => void onConfirm()} disabled={busy} className={buttonClass}>
            {busy ? "Linking…" : "Link account"}
          </button>
          <button type="button" onClick={() => setPreview(null)} disabled={busy} className={quietButtonClass}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onCheck} className="flex flex-col gap-4">
      <p className="text-sm text-[var(--tfmc-mist)]">
        Run <code className="text-[var(--tfmc-accent)]">/linkdiscord</code> in game, click the code in chat to copy it, then paste it here.
      </p>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">Link code</span>
        <input
          type="text"
          name="code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
          placeholder="e.g. ABCD-1234-EF56"
          className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60"
        />
      </label>
      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" disabled={busy} className={`${buttonClass} self-start`}>
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}

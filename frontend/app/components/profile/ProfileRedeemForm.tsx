"use client";

import { FormEvent, useState } from "react";
import FancyCheckbox from "../skins/FancyCheckbox";
import {
  CharactersApiError,
  redeemProfile,
} from "../../../lib/characters/api";
import {
  setSession,
  type ProfileSession,
} from "../../../lib/profile/session";

type Props = {
  onRedeemed: (session: ProfileSession) => void;
  variant?: "default" | "compact";
};

export default function ProfileRedeemForm({
  onRedeemed,
  variant = "default",
}: Props) {
  const compact = variant === "compact";
  const [code, setCode] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter a code");
      return;
    }

    setLoading(true);
    try {
      const result = await redeemProfile(trimmed, rememberMe);
      const session: ProfileSession = {
        session_token: result.session_token,
        player_uuid: result.player_uuid,
        expires_at: result.expires_at,
        scope: result.scope || "profile",
        ...(result.realm_id ? { realm_id: result.realm_id } : {}),
        remember_me: rememberMe,
      };
      setSession(session, rememberMe);
      onRedeemed(session);
    } catch (err) {
      const message =
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn’t log in. Check the code and try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className={`flex w-full flex-col gap-4 ${compact ? "mt-4" : "mt-8"}`}
    >
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">
          {compact ? "Log in with code" : "Profile code"}
        </span>
        <input
          type="text"
          name="code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={loading}
          placeholder="e.g. ABCD-1234"
          className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60"
        />
      </label>

      {!compact ? (
        <label className="flex items-start gap-3 text-left text-sm text-[var(--tfmc-mist)]">
          <FancyCheckbox
            checked={rememberMe}
            disabled={loading}
            onChange={setRememberMe}
            aria-label="Remember me"
          />
          <span>
            <span className="font-medium text-[var(--tfmc-stone)]">
              Remember me
            </span>
            <span className="mt-0.5 block text-[var(--tfmc-mist)]">
              Stay logged in for 30 days.
            </span>
          </span>
        </label>
      ) : null}

      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading
          ? compact
            ? "Entering…"
            : "Logging in…"
          : compact
            ? "Enter"
            : "Log in"}
      </button>
    </form>
  );
}

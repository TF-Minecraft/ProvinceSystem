"use client";

import { useRouter, usePathname } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import {
  CharactersApiError,
  redeemProfile,
} from "@/lib/characters/api";
import {
  clearSession,
  setSession,
  type ProfileSession,
} from "@/lib/profile/session";
import { SITE_DISCORD_URL } from "@/lib/site/config";
import { hasSiteStaffAccess } from "@/lib/site/staffAccess";

const STAFF_DENIED_MESSAGE =
  "This site is in development. Staff access only.";

type Props = {
  loading?: boolean;
  accessDenied?: boolean;
  onStaffVerified: () => void;
};

function HubAtmosphere() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 80% 60% at 50% 35%, color-mix(in srgb, var(--tfmc-moss) 55%, transparent), transparent 70%),
            radial-gradient(ellipse 100% 80% at 50% 100%, color-mix(in srgb, var(--tfmc-forest) 80%, #000), transparent),
            linear-gradient(165deg, var(--tfmc-forest-deep) 0%, var(--tfmc-forest) 45%, #152820 100%)
          `,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </>
  );
}

export default function DevLandingPage({
  loading = false,
  accessDenied = false,
  onStaffVerified,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [code, setCode] = useState("");
  const [staffError, setStaffError] = useState<string | null>(
    accessDenied ? STAFF_DENIED_MESSAGE : null
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (accessDenied) {
      clearSession();
      setStaffError(STAFF_DENIED_MESSAGE);
    }
  }, [accessDenied]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStaffError(null);

    const trimmed = code.trim();
    if (!trimmed) {
      setStaffError("Enter a code");
      return;
    }

    setSubmitting(true);
    try {
      const result = await redeemProfile(trimmed, false);
      const session: ProfileSession = {
        session_token: result.session_token,
        player_uuid: result.player_uuid,
        expires_at: result.expires_at,
        scope: result.scope || "profile",
        ...(result.realm_id ? { realm_id: result.realm_id } : {}),
        remember_me: false,
      };
      const staff = await hasSiteStaffAccess(session.session_token);
      if (!staff) {
        clearSession();
        setStaffError(STAFF_DENIED_MESSAGE);
        return;
      }
      setSession(session, false);
      onStaffVerified();
      const returnPath = pathname && pathname !== "/" ? pathname : "/";
      router.replace(returnPath);
    } catch (err) {
      const message =
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Redeem failed";
      setStaffError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const showSpinner = loading || submitting;

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-6">
      <HubAtmosphere />

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        <h1 className="hub-rise">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-512.webp"
            alt="TFMC"
            width={208}
            height={208}
            className="block h-40 w-40 sm:h-52 sm:w-52"
          />
        </h1>
        <p className="hub-rise-delay mt-4 text-lg text-[var(--tfmc-mist)] sm:text-xl">
          We are in development
        </p>
        <p className="hub-fade-delay mt-2 font-[family-name:var(--font-fraunces)] text-2xl font-medium text-[var(--tfmc-cream)] sm:text-3xl">
          Season 5 Coming Soon
        </p>

        <a
          href={SITE_DISCORD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hub-fade-delay mt-8 inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-6 py-3 text-sm font-semibold tracking-wide text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-cream)]"
        >
          Join our Discord
        </a>

        <div className="hub-fade-delay mt-10 w-full border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] pt-8">
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--tfmc-stone)]">
            Staff access
          </p>

          {showSpinner ? (
            <p className="mt-4 text-sm text-[var(--tfmc-mist)]">Checking access…</p>
          ) : (
            <>
              <form
                onSubmit={onSubmit}
                className="mt-4 flex w-full flex-col gap-4"
              >
                <label className="flex flex-col gap-2 text-left">
                  <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                    Log in with code
                  </span>
                  <input
                    type="text"
                    name="code"
                    autoComplete="off"
                    spellCheck={false}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    disabled={submitting}
                    placeholder="e.g. ABCD-1234"
                    className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Enter
                </button>
              </form>
              {staffError ? (
                <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
                  {staffError}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

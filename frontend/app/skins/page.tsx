"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import RedeemForm from "../components/skins/RedeemForm";
import UploadForm from "../components/skins/UploadForm";
import { getPlayerMeta } from "../../lib/skins/api";
import {
  clearSession,
  getLastSubmissionId,
  getSession,
  isSessionValid,
  setSession,
  type SkinsSession,
} from "../../lib/skins/session";
import { formatExpiresIn } from "../../lib/skins/formatTime";
import {
  getSession as getProfileSession,
  isSessionValid as isProfileSessionValid,
} from "../../lib/profile/session";
import { canOpenProfile } from "../../lib/profile/redirect";
import Link from "next/link";

export default function SkinsPage() {
  const router = useRouter();
  const newCodeTitleId = useId();
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<SkinsSession | null>(null);
  const [metaSynced, setMetaSynced] = useState(true);
  const [confirmNewCode, setConfirmNewCode] = useState(false);
  const [fromProfile, setFromProfile] = useState(false);

  useEffect(() => {
    const existing = getSession();
    if (isSessionValid(existing)) {
      const lastId = getLastSubmissionId();
      if (lastId) {
        router.replace(`/skins/${encodeURIComponent(lastId)}`);
        return;
      }
      setSessionState(existing);
      setFromProfile(isProfileSessionValid(getProfileSession()));
      setReady(true);
      return;
    }
    if (existing) clearSession();
    // Skins start from Profile now; this page stays for in-game codes.
    let live = true;
    void canOpenProfile().then((open) => {
      if (!live) return;
      if (open) router.replace("/profile?tab=skins");
      else setReady(true);
    });
    return () => {
      live = false;
    };
  }, [router]);

  useEffect(() => {
    if (!session || !isSessionValid(session)) return;
    let cancelled = false;
    async function refreshMeta() {
      try {
        const meta = await getPlayerMeta(session!.session_token);
        if (cancelled) return;
        const next: SkinsSession = {
          ...session!,
          name_colour_stops: meta.name_colour_stops,
          max_3d_pair_bytes: meta.max_3d_pair_bytes,
          skin_token_cooldown_days: meta.skin_token_cooldown_days,
          skin_kinds: meta.skin_kinds,
          allow_armor_3d_helmet: meta.allow_armor_3d_helmet,
        };
        setSession(next);
        setSessionState(next);
        setMetaSynced(meta.meta_synced !== false);
      } catch {
        // Keep redeem-time session snapshot if refresh fails.
      }
    }
    void refreshMeta();
    return () => {
      cancelled = true;
    };
  }, [session?.session_token]);

  function onRedeemed(next: SkinsSession) {
    setSessionState(next);
  }

  function confirmUseNewCode() {
    clearSession();
    setSessionState(null);
    setConfirmNewCode(false);
  }

  if (!ready) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col justify-center px-6 py-16">
        <p className="text-[var(--tfmc-mist)]">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Skins
      </h1>

      {session && isSessionValid(session) ? (
        <div className="mt-4">
          {fromProfile ? (
            <Link
              href="/profile?tab=skins"
              className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
            >
              ← Profile
            </Link>
          ) : (
            <>
              <p className="text-sm text-[var(--tfmc-stone)]">
                Session expires {formatExpiresIn(session.expires_at)}
                {session.staff ? (
                  <span className="ml-2 text-[var(--tfmc-accent)]">· Staff</span>
                ) : null}
              </p>
              <button
                type="button"
                className="mt-2 text-xs text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
                onClick={() => setConfirmNewCode(true)}
              >
                Use a new code
              </button>
            </>
          )}
          <UploadForm
            sessionToken={session.session_token}
            staff={session.staff === true}
            nameColourStops={session.name_colour_stops}
            max3dPairBytes={session.max_3d_pair_bytes}
            skinKinds={session.skin_kinds ?? null}
            allowArmor3dHelmet={session.allow_armor_3d_helmet === true}
            colourLockedMessage={
              !metaSynced && (session.name_colour_stops ?? 0) <= 0
                ? "Join the server once to unlock your rank perks."
                : undefined
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-3 text-[var(--tfmc-mist)]">
            Enter the code from in-game to start a skin submission.
          </p>
          <RedeemForm onRedeemed={onRedeemed} />
        </>
      )}

      {confirmNewCode ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,var(--tfmc-forest)_72%,black)]/80 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => setConfirmNewCode(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={newCodeTitleId}
            className="w-full max-w-sm rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[var(--tfmc-forest)] p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id={newCodeTitleId}
              className="font-[family-name:var(--font-display)] text-lg text-[var(--tfmc-cream)]"
            >
              Use a new code?
            </h2>
            <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
              You&apos;ll need a new code from in-game. Anything not submitted
              will be lost.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmNewCode(false)}
                className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmUseNewCode}
                className="rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90"
              >
                Use a new code
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

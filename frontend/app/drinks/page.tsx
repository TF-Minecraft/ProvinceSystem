"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import RedeemForm from "../components/drinks/RedeemForm";
import BrewForm from "../components/drinks/BrewForm";
import {
  clearSession,
  getLastSubmissionId,
  getSession,
  isSessionValid,
  type DrinksSession,
} from "../../lib/drinks/session";
import { formatExpiresIn } from "../../lib/skins/formatTime";
import {
  getSession as getProfileSession,
  isSessionValid as isProfileSessionValid,
} from "../../lib/profile/session";
import { canOpenProfile } from "../../lib/profile/redirect";
import Link from "next/link";

export default function DrinksPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<DrinksSession | null>(null);
  const [fromProfile, setFromProfile] = useState(false);

  useEffect(() => {
    const existing = getSession();
    if (isSessionValid(existing)) {
      const lastId = getLastSubmissionId();
      if (lastId) {
        router.replace(`/drinks/${encodeURIComponent(lastId)}`);
        return;
      }
      setSessionState(existing);
      setFromProfile(isProfileSessionValid(getProfileSession()));
      setReady(true);
      return;
    }
    if (existing) clearSession();
    // Drinks start from Profile now; this page stays for in-game codes.
    let live = true;
    void canOpenProfile().then((open) => {
      if (!live) return;
      if (open) router.replace("/profile?tab=drinks");
      else setReady(true);
    });
    return () => {
      live = false;
    };
  }, [router]);

  function onRedeemed(next: DrinksSession) {
    setSessionState(next);
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
        Drinks
      </h1>
      {session && isSessionValid(session) ? (
        <div className="mt-4">
          {fromProfile ? (
            <Link
              href="/profile?tab=drinks"
              className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
            >
              ← Profile
            </Link>
          ) : (
            <>
              <p className="text-sm text-[var(--tfmc-stone)]">
                Session expires {formatExpiresIn(session.expires_at)}
              </p>
              <button
                type="button"
                className="mt-2 text-xs text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
                onClick={() => {
                  clearSession();
                  setSessionState(null);
                }}
              >
                End session
              </button>
            </>
          )}
          <BrewForm session={session} />
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
            Redeem a drink code from{" "}
            <code className="text-[var(--tfmc-accent)]">/token create drink</code>,
            then design your drink for staff review.
          </p>
          <RedeemForm onRedeemed={onRedeemed} />
        </>
      )}
    </main>
  );
}

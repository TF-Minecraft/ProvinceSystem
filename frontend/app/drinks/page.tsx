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
import { formatExpiresIn, formatLocal } from "../../lib/skins/formatTime";

export default function DrinksPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [session, setSessionState] = useState<DrinksSession | null>(null);

  useEffect(() => {
    const existing = getSession();
    if (isSessionValid(existing)) {
      const lastId = getLastSubmissionId();
      if (lastId) {
        router.replace(`/drinks/${encodeURIComponent(lastId)}`);
        return;
      }
      setSessionState(existing);
    } else if (existing) {
      clearSession();
    }
    setReady(true);
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
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Redeem a drink token from{" "}
        <code className="text-[var(--tfmc-accent)]">/token create drink</code>,
        then design a BreweryX recipe for staff review.
      </p>

      {session && isSessionValid(session) ? (
        <div className="mt-4">
          <p className="text-sm text-[var(--tfmc-stone)]">
            Session expires {formatExpiresIn(session.expires_at)} (
            {formatLocal(session.expires_at)})
            {session.allow_drink_texture ? (
              <span className="ml-2 text-[var(--tfmc-accent)]">
                · Texture allowed
              </span>
            ) : (
              <span className="ml-2 text-[var(--tfmc-mist)]">· Color only</span>
            )}
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
          <BrewForm session={session} />
        </div>
      ) : (
        <RedeemForm onRedeemed={onRedeemed} />
      )}
    </main>
  );
}

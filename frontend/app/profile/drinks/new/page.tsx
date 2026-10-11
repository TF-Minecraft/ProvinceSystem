"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProfileSubpage from "../../../components/profile/ProfileSubpage";
import BrewForm from "../../../components/drinks/BrewForm";
import { drinkPath } from "../../../../lib/profile/paths";
import {
  clearSession,
  getLastSubmissionId,
  getSession,
  isSessionValid,
  type DrinksSession,
} from "../../../../lib/drinks/session";

/** The drink editor, for a session Profile started or an in-game code opened. */
export default function NewDrinkPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<DrinksSession | null>(null);

  useEffect(() => {
    const existing = getSession();
    if (!isSessionValid(existing)) {
      if (existing) clearSession();
      router.replace("/profile?tab=drinks");
      return;
    }
    // Back from a submitted drink: its code is spent, so show the drink instead.
    const lastId = getLastSubmissionId();
    if (lastId) {
      router.replace(drinkPath(lastId));
      return;
    }
    setSessionState(existing);
  }, [router]);

  return (
    <ProfileSubpage tab="drinks" title="New drink">
      {session ? (
        <div className="mt-4">
          <BrewForm session={session} />
        </div>
      ) : (
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      )}
    </ProfileSubpage>
  );
}

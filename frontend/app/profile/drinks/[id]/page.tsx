"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ProfileSubpage from "../../../components/profile/ProfileSubpage";
import StatusCard from "../../../components/drinks/StatusCard";
import { getSubmission, type DrinkSubmissionPublic } from "../../../../lib/drinks/api";
import {
  clearSession as clearDrinksSession,
  getSession as getDrinksSession,
  isSessionValid as isDrinksSessionValid,
} from "../../../../lib/drinks/session";
import { resolveOwnerToken } from "../../../../lib/profile/session";

/** One of the player's drinks and where it is in review. */
export default function DrinkStatusPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [row, setRow] = useState<DrinkSubmissionPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = resolveOwnerToken({
      getSession: getDrinksSession,
      isSessionValid: isDrinksSessionValid,
      clearSession: clearDrinksSession,
    });
    if (!token) {
      router.replace("/profile?tab=drinks");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRow(await getSubmission(id, token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ProfileSubpage tab="drinks" title="Drink">
      {loading ? (
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : row ? (
        <>
          <StatusCard row={row} />
          <button
            type="button"
            onClick={() => void load()}
            className="mt-8 self-start text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
          >
            Refresh status
          </button>
        </>
      ) : null}
    </ProfileSubpage>
  );
}

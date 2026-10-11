"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusCard from "../../components/drinks/StatusCard";
import { getSubmission, DrinksApiError, type DrinkSubmissionPublic } from "../../../lib/drinks/api";
import {
  clearSession as clearDrinksSession,
  getSession as getDrinksSession,
  isSessionValid as isDrinksSessionValid,
} from "../../../lib/drinks/session";
import { resolveOwnerToken } from "../../../lib/profile/session";

export default function DrinkStatusPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [row, setRow] = useState<DrinkSubmissionPublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = resolveOwnerToken({
      getSession: getDrinksSession,
      isSessionValid: isDrinksSessionValid,
      clearSession: clearDrinksSession,
    });
    if (!token) {
      setError("Session missing or expired. Log in on Profile or redeem a drink code.");
      setRow(null);
      setLoading(false);
      return;
    }
    if (!id) {
      setError("Missing submission id");
      setRow(null);
      setLoading(false);
      return;
    }
    try {
      const data = await getSubmission(id, token);
      setRow(data);
    } catch (err) {
      const message =
        err instanceof DrinksApiError ? err.message : err instanceof Error ? err.message : "Failed to load";
      setError(message);
      setRow(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  function onSubmitAnother() {
    clearDrinksSession();
    router.push("/drinks");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">Drink submission</h1>

      {loading ? (
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      ) : error ? (
        <div className="mt-6">
          <p className="text-sm text-[#e8a0a0]" role="alert">
            {error}
          </p>
          <Link href="/drinks" className="mt-4 inline-block text-sm text-[var(--tfmc-accent)] hover:underline">
            Back to drinks
          </Link>
        </div>
      ) : row ? (
        <>
          <StatusCard row={row} />
          <div className="mt-8 flex flex-wrap gap-4">
            <button
              type="button"
              onClick={() => void load()}
              className="text-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
            >
              Refresh status
            </button>
            <button
              type="button"
              onClick={onSubmitAnother}
              className="text-sm text-[var(--tfmc-accent)] underline-offset-2 hover:underline"
            >
              Submit another
            </button>
          </div>
        </>
      ) : null}
    </main>
  );
}

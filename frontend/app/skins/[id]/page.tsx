"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import StatusCard from "../../components/skins/StatusCard";
import {
  getSubmission,
  SkinsApiError,
  type SubmissionPublic,
} from "../../../lib/skins/api";
import {
  clearSession as clearSkinsSession,
  getSession as getSkinsSession,
  isSessionValid as isSkinsSessionValid,
} from "../../../lib/skins/session";
import {
  getSession as getProfileSession,
  isSessionValid as isProfileSessionValid,
} from "../../../lib/profile/session";

function resolveOwnerToken(): string | null {
  const skin = getSkinsSession();
  if (isSkinsSessionValid(skin)) return skin!.session_token;
  const profile = getProfileSession();
  if (isProfileSessionValid(profile)) return profile!.session_token;
  if (skin) clearSkinsSession();
  return null;
}

export default function SubmissionStatusPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [row, setRow] = useState<SubmissionPublic | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const token = resolveOwnerToken();
    if (!token) {
      setError("Session missing or expired. Log in on Profile or redeem a skin code.");
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
      setToken(token);
    } catch (err) {
      const message =
        err instanceof SkinsApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to load";
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
    clearSkinsSession();
    router.push("/skins");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100dvh-var(--tfmc-header-h))] max-w-lg flex-col px-6 py-16">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">
        Submission
      </h1>

      {loading ? (
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      ) : error ? (
        <div className="mt-6">
          <p className="text-sm text-[#e8a0a0]" role="alert">
            {error}
          </p>
          <Link
            href="/skins"
            className="mt-4 inline-block text-sm text-[var(--tfmc-accent)] hover:underline"
          >
            Back to skins
          </Link>
        </div>
      ) : row && token ? (
        <>
          <StatusCard row={row} sessionToken={token} />
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

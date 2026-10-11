"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import ProfileSubpage from "../../../components/profile/ProfileSubpage";
import StatusCard from "../../../components/skins/StatusCard";
import { getSubmission, type SubmissionPublic } from "../../../../lib/skins/api";
import {
  clearSession as clearSkinsSession,
  getSession as getSkinsSession,
  isSessionValid as isSkinsSessionValid,
} from "../../../../lib/skins/session";
import { resolveOwnerToken } from "../../../../lib/profile/session";

/** One of the player's skins and where it is in review. */
export default function SkinStatusPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const [row, setRow] = useState<SubmissionPublic | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const token = resolveOwnerToken({
      getSession: getSkinsSession,
      isSessionValid: isSkinsSessionValid,
      clearSession: clearSkinsSession,
    });
    if (!token) {
      router.replace("/profile?tab=skins");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRow(await getSubmission(id, token));
      setToken(token);
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
    <ProfileSubpage tab="skins" title="Skin">
      {loading ? (
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      ) : error ? (
        <p className="mt-6 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : row && token ? (
        <>
          <StatusCard row={row} sessionToken={token} />
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ProfileSubpage from "../../../components/profile/ProfileSubpage";
import UploadForm from "../../../components/skins/UploadForm";
import { getPlayerMeta } from "../../../../lib/skins/api";
import { skinPath } from "../../../../lib/profile/paths";
import {
  clearSession,
  getLastSubmissionId,
  getSession,
  isSessionValid,
  setSession,
  type SkinsSession,
} from "../../../../lib/skins/session";

/** The skin editor, for a session Profile started or an in-game code opened. */
export default function NewSkinPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<SkinsSession | null>(null);
  const [metaSynced, setMetaSynced] = useState(true);

  useEffect(() => {
    const existing = getSession();
    if (!isSessionValid(existing)) {
      if (existing) clearSession();
      router.replace("/profile?tab=skins");
      return;
    }
    // Back from a submitted skin: its code is spent, so show the skin instead.
    const lastId = getLastSubmissionId();
    if (lastId) {
      router.replace(skinPath(lastId));
      return;
    }
    setSessionState(existing);
  }, [router]);

  const token = session?.session_token;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getPlayerMeta(token)
      .then((meta) => {
        if (cancelled) return;
        const current = getSession();
        if (!current || current.session_token !== token) return;
        const next: SkinsSession = {
          ...current,
          name_colour_stops: meta.name_colour_stops,
          max_3d_pair_bytes: meta.max_3d_pair_bytes,
          skin_token_cooldown_days: meta.skin_token_cooldown_days,
          skin_kinds: meta.skin_kinds,
          allow_armor_3d_helmet: meta.allow_armor_3d_helmet,
        };
        setSession(next);
        setSessionState(next);
        setMetaSynced(meta.meta_synced !== false);
      })
      .catch(() => {
        // Keep the redeem-time snapshot.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <ProfileSubpage tab="skins" title="New skin">
      {session ? (
        <div className="mt-4">
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
        <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
      )}
    </ProfileSubpage>
  );
}

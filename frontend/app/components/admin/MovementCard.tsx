"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { getAdminMe } from "../../../lib/admin/api";

/** A way into the player's movement page, for those allowed to see it (admins and the owner). */
export default function MovementCard({ uuid }: { uuid: string }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    getAdminMe()
      .then((me) => live && setAllowed(me.capabilities.includes("view_player_movement")))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!allowed) return null;
  return (
    <section
      aria-label="Movement"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-5"
    >
      <div>
        <h3 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">Movement</h3>
        <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
          Where they went, session by session or over any time range, on the map.
        </p>
      </div>
      <Link
        href={`/admin/players/${encodeURIComponent(uuid)}/movement`}
        className="rounded-sm border border-[var(--tfmc-accent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_15%,transparent)]"
      >
        Open movement
      </Link>
    </section>
  );
}

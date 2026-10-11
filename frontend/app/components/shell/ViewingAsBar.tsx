"use client";

import { useEffect, useState } from "react";

import { leaveExpiredView, leaveView } from "@/lib/account/viewAs";

/**
 * Pinned to the bottom of every page while an admin views the site as a player,
 * so it never moves the page. The view ends on its own when it runs out.
 */
export default function ViewingAsBar({ name, expiresAt }: { name: string; expiresAt: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const leave = () => {
    setBusy(true);
    setFailed(false);
    leaveView().catch(() => {
      setBusy(false);
      setFailed(true);
    });
  };

  useEffect(() => {
    const ms = Date.parse(expiresAt) - Date.now();
    if (Number.isNaN(ms)) return;
    const timer = window.setTimeout(() => leaveExpiredView(expiresAt).catch(() => setFailed(true)), Math.max(0, ms));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[105] mx-auto flex w-fit max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-full border border-[#e8c48a]/40 bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_94%,transparent)] px-4 py-2 text-sm text-[#e8c48a] shadow-lg backdrop-blur-md"
    >
      <span>
        Viewing as <strong className="font-semibold">{name}</strong> · view only
      </span>
      <button
        type="button"
        onClick={leave}
        disabled={busy}
        className="font-medium text-[var(--tfmc-cream)] underline-offset-2 hover:underline disabled:opacity-60"
      >
        {failed ? "Try again" : busy ? "Switching back…" : "Back to my account"}
      </button>
    </div>
  );
}

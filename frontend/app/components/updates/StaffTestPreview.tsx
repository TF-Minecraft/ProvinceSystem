"use client";

import { useEffect, useState } from "react";

import { WeekSections } from "@/app/components/updates/WeekArchiveList";
import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";
import { getSession, isSessionValid } from "@/lib/characters/session";
import { readStaffPreview, type StaffPreview } from "@/lib/patchnotes/preview";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_API_URL || "").trim().replace(/\/$/, "");
}

export default function StaffTestPreview() {
  const { state } = useSiteStaffAccess();
  const [preview, setPreview] = useState<StaffPreview | null>(null);

  useEffect(() => {
    if (state !== "staff") {
      setPreview(null);
      return;
    }
    const session = getSession();
    const token = isSessionValid(session) ? (session?.session_token ?? "") : "";
    const base = apiBase();
    if (!token || !base) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${base}/patchnotes/staff/preview`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setPreview(null);
          return;
        }
        const next = readStaffPreview(await res.json());
        if (!cancelled) setPreview(next);
      } catch {
        if (!cancelled) setPreview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  useEffect(() => {
    if (!preview) return;
    const expires = Date.parse(preview.expiresAt);
    if (!Number.isFinite(expires)) return;
    const timer = window.setTimeout(() => setPreview(null), Math.max(0, expires - Date.now()));
    return () => window.clearTimeout(timer);
  }, [preview]);

  if (!preview) return null;

  return (
    <aside className="mt-10 rounded-md border border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_35%,transparent)] px-4 py-4">
      <p className="text-sm text-[var(--tfmc-mist)]">
        This is a test. Only staff can see it, and it is removed one hour after it was created.
      </p>
      <h2 className="mt-3 font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
        {preview.label}
      </h2>
      <WeekSections bullets={preview.bullets} />
    </aside>
  );
}

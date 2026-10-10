"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AccountApiError } from "../../../lib/account/api";
import {
  adminErrorMessage,
  coreProtectMessage,
  getAdminMe,
  getPlayer,
  type AdminMe,
  type PlayerProfile as Profile,
} from "../../../lib/admin/api";
import { formatAgo, formatEpoch } from "../../../lib/admin/time";
import AdminColumn from "./AdminColumn";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import PlayerTabs, { profileTab } from "./PlayerTabs";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "failed"; message: string } | { kind: "ready"; profile: Profile };

export type PlayerData = {
  profile: Profile;
  me: AdminMe | null;
  /** Admins and the owner; mods see the profile without it. */
  movement: boolean;
  reload: () => void;
};

const PlayerContext = createContext<PlayerData | null>(null);

/** The player the frame has loaded; null outside one. */
export function usePlayer(): PlayerData | null {
  return useContext(PlayerContext);
}

/**
 * The player's name, details and tabs, shared by the profile and the movement
 * page so they stay put from tab to tab. Its pages render once the player has loaded,
 * so nothing arrives above them later and pushes them down.
 */
export default function PlayerFrame({ uuid, children }: { uuid: string; children: React.ReactNode }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [me, setMe] = useState<AdminMe | null>(null);
  const pathname = usePathname();
  const search = useSearchParams();
  const current = pathname.endsWith("/movement") ? "movement" : profileTab(search.get("tab"));

  useEffect(() => {
    let live = true;
    getAdminMe()
      .then((value) => live && setMe(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const loadProfile = useCallback(() => {
    let live = true;
    getPlayer(uuid)
      .then((profile) => live && setLoad({ kind: "ready", profile }))
      .catch((err) => {
        if (!live) return;
        const status = err instanceof AccountApiError ? err.status : 0;
        setLoad(status === 400 || status === 404 ? { kind: "failed", message: adminErrorMessage(err) } : { kind: gateKind(err) });
      });
    return () => {
      live = false;
    };
  }, [uuid]);

  useEffect(() => loadProfile(), [loadProfile]);

  const back = (
    <Link href="/admin/players" className="text-sm text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
      ← All players
    </Link>
  );
  if (load.kind !== "ready") {
    return (
      <AdminColumn>
        <p className="mt-4">{back}</p>
        {load.kind === "loading" ? (
          <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
        ) : load.kind === "failed" ? (
          <p className="mt-6 text-[var(--tfmc-mist)]" role="alert">
            {load.message}
          </p>
        ) : (
          <StaffGateMessage kind={load.kind} />
        )}
      </AdminColumn>
    );
  }

  const { profile } = load;
  const movement = me?.capabilities.includes("view_player_movement") ?? false;
  const notice = coreProtectMessage(profile.coreprotect);
  const label = profile.coreprotect.server_label;
  const seen = [
    profile.online ? "Seen just now" : `Last seen ${formatAgo(profile.last_seen).toLowerCase()}`,
    profile.first_seen ? `first seen ${formatEpoch(profile.first_seen)}` : null,
    label,
    profile.past_names.length ? `previously ${profile.past_names.map((n) => n.name).join(", ")}` : null,
  ].filter(Boolean);

  return (
    <>
      <AdminColumn>
        {/* Two lines on every tab, so the tabs under them never move and the map keeps its height. */}
        <header className="mt-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            {back}
            <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
              {profile.minecraft_name ?? "Unknown name"}
            </h2>
            <span className="font-mono text-xs text-[var(--tfmc-stone)]">{profile.uuid}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
            {seen.join(" · ")}
            {" · "}
            <Link href={`/admin/ranks/players/${profile.uuid}`} className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
              In-game ranks and permissions →
            </Link>
          </p>
          {notice ? (
            <p className="mt-2 text-sm text-[#e8c48a]" role="status">
              {notice}
            </p>
          ) : null}
        </header>
        <PlayerTabs uuid={profile.uuid} current={current} movement={movement} />
      </AdminColumn>
      <PlayerContext.Provider value={{ profile, me, movement, reload: loadProfile }}>{children}</PlayerContext.Provider>
    </>
  );
}

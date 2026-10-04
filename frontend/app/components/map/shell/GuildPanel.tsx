"use client";

import type { GuildProfile } from "@/app/lib/map/guildProfile";
import { cleanRegionName } from "@/app/lib/mapLabels";

import type { RegionRecord, SettlementMarker } from "../types";
import { Fact, RegionLink, Section } from "./RealmPanel";
import { FocusIcon, RealmIcon } from "./MapIcons";
import PanelHeader from "./PanelHeader";

type GuildPanelProps = {
  guild: GuildProfile;
  regionData: RegionRecord | null;
  /** The guild's capital settlement, if the map has one there. */
  seat: SettlementMarker | null;
  /** Provinces whose trade it dominates, when the Guilds map is open. */
  tradeProvinces?: number | null;
  onSelectRegion: (regionId: string) => void;
  onSelectPlace: (markerId: string) => void;
  onFocusPoint: (mapX: number, mapY: number) => void;
  onClose: () => void;
};

/** A guild's card: its realm, leader, size, seat and branches. */
export function GuildPanelContent({
  guild,
  regionData,
  seat,
  tradeProvinces = null,
  onSelectRegion,
  onSelectPlace,
  onFocusPoint,
  onClose,
}: GuildPanelProps) {
  const realm = regionData?.[guild.factionId];
  const realmName = cleanRegionName(realm?.name ?? guild.factionId) || guild.factionId;
  const seatPlaced =
    seat && typeof seat.map_x === "number" && typeof seat.map_y === "number" ? seat : null;

  return (
    <article aria-label={guild.name}>
      <PanelHeader
        onClose={onClose}
        centred
        title={guild.name}
        eyebrow={`${guild.typeLabel} of ${realmName}`}
        visual={
          <div
            aria-hidden
            className="map-banner-frame h-16 w-16 shrink-0"
            style={{ backgroundColor: guild.rgb ? `rgb(${guild.rgb})` : "#555" }}
          />
        }
        subtitle={
          <p className="mt-1 flex items-center gap-2 text-sm text-[var(--tfmc-stone)]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/60"
              style={{ backgroundColor: realm?.rgb ? `rgb(${realm.rgb})` : "#555" }}
            />
            <RegionLink id={guild.factionId} regionData={regionData ?? {}} onSelectRegion={onSelectRegion} />
          </p>
        }
      />

      <div className="mb-4 flex items-baseline gap-2 rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] bg-black/20 px-3 py-2">
        <span className="shrink-0 text-xs text-[var(--tfmc-mist)]">Leader</span>
        {guild.leader ? (
          <span className="truncate font-[family-name:var(--font-fraunces)] text-base text-[var(--tfmc-cream)]">
            {guild.leader}
          </span>
        ) : (
          <span className="truncate text-sm italic text-[var(--tfmc-stone)]">
            Character not yet known
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Members">{guild.members}</Fact>
        {tradeProvinces !== null ? (
          <Fact label="Dominates trade in">
            {tradeProvinces} {tradeProvinces === 1 ? "province" : "provinces"}
          </Fact>
        ) : null}
        <Fact label="Capital">
          {seat ? (
            <button
              type="button"
              onClick={() => onSelectPlace(seat.id)}
              className="map-link text-left"
            >
              {cleanRegionName(seat.name)}
            </button>
          ) : (
            "—"
          )}
        </Fact>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        {seatPlaced ? (
          <button
            type="button"
            onClick={() => onFocusPoint(seatPlaced.map_x!, seatPlaced.map_y!)}
            className="map-control h-9 px-3 text-sm"
          >
            <FocusIcon size={16} />
            Zoom to
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onSelectRegion(guild.factionId)}
          className="map-control h-9 px-3 text-sm"
        >
          <RealmIcon size={16} />
          View realm
        </button>
      </div>

      {guild.branches.length > 0 ? (
        <Section title="Branches">
          <ul className="space-y-1.5">
            {guild.branches.map((branch) => (
              <li key={branch.id} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-[var(--tfmc-cream)]">
                  {branch.label}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--tfmc-stone)]">
                  Level {branch.level}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}

/** A clickable list of guilds, for the realm and place cards. */
export function GuildList({
  guilds,
  onSelectGuild,
}: {
  guilds: GuildProfile[];
  onSelectGuild: (key: string) => void;
}) {
  return (
    <ul className="space-y-1">
      {guilds.map((guild) => (
        <li key={guild.key}>
          <button
            type="button"
            onClick={() => onSelectGuild(guild.key)}
            className="flex w-full items-center gap-2.5 rounded px-1.5 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
          >
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/60"
              style={{ backgroundColor: guild.rgb ? `rgb(${guild.rgb})` : "#555" }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-[var(--tfmc-cream)]">{guild.name}</span>
              <span className="block truncate text-xs text-[var(--tfmc-stone)]">
                {guild.leader ?? guild.typeLabel}
              </span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-[var(--tfmc-stone)]">
              {guild.members} {guild.members === 1 ? "member" : "members"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

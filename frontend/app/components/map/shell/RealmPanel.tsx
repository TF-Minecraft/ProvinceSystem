"use client";

import { useMemo, type ReactNode } from "react";

import {
  buildRealmProfile,
  formatFoundedDate,
  realmCapitalSettlement,
  relationKindLabel,
  sortRealmRelations,
  type RealmProfile,
  type RealmRelation,
} from "@/app/lib/map/realmProfile";
import { cleanRegionName } from "@/app/lib/mapLabels";
import { realmGuilds } from "@/app/lib/map/guildProfile";

import MapAuthImage from "../MapAuthImage";
import { buildRegionInfo } from "../regionInfo";
import type { MapId, MapMode, RegionRecord, SettlementMarker } from "../types";
import { FocusIcon, SubjectsIcon } from "./MapIcons";
import { PanelCloseButton } from "./SheetCloseButton";
import { GuildList } from "./GuildPanel";

export type RealmPanelProps = {
  mapId: MapId;
  mapType: MapMode;
  regionId: string;
  regionData: RegionRecord;
  mapDisplayName: string;
  sessionToken?: string | null;
  settlements: SettlementMarker[];
  /** Open another region's panel: an overlord, subject or neighbour. */
  onSelectRegion: (regionId: string) => void;
  /** Fly to a map point, e.g. the capital. */
  onFocusPoint?: (mapX: number, mapY: number) => void;
  /** Open a settlement's own card, e.g. the capital's. */
  onSelectPlace?: (markerId: string) => void;
  /** Open a guild's card. */
  onSelectGuild?: (guildKey: string) => void;
  onFocusRegion?: () => void;
  /** Open the subject layout; absent when the region has none to show. */
  onShowSubjects?: () => void;
  onClose: () => void;
};

const ATTITUDE_STYLES: Record<string, string> = {
  friendly: "border-emerald-400/50 bg-emerald-400/10 text-emerald-200",
  neutral: "border-[var(--tfmc-stone)]/40 bg-white/5 text-[var(--tfmc-stone)]",
  unfriendly: "border-amber-400/50 bg-amber-400/10 text-amber-200",
  hostile: "border-red-400/60 bg-red-500/15 text-red-200",
};

function regionName(regionData: RegionRecord, id: string): string {
  return cleanRegionName(regionData[id]?.name ?? id) || id;
}

export function Banner({
  mapId,
  mapType,
  banner,
  name,
  sessionToken,
  className,
}: {
  mapId: MapId;
  mapType: MapMode;
  banner: string | null | undefined;
  name: string;
  sessionToken?: string | null;
  className: string;
}) {
  if (!banner) {
    return <div aria-hidden className={`map-banner-frame ${className}`} />;
  }
  return (
    <div className={`map-banner-frame ${className}`}>
      <MapAuthImage
        mapId={mapId}
        // `banner` is a raw field out of region data, which on a stored day is
        // an immutable file this app did not produce. Unencoded, `"../../.."`
        // walks to a different backend path and `"x?next=/e"` smuggles a query
        // and drops the `.png`.
        path={`/${mapId}/banners/${mapType}/${encodeURIComponent(banner)}.png`}
        sessionToken={sessionToken}
        alt={`${name} banner`}
        className="image-render-pixel h-full w-full object-cover"
      />
    </div>
  );
}

export function RegionLink({
  id,
  regionData,
  onSelectRegion,
}: {
  id: string;
  regionData: RegionRecord;
  onSelectRegion: (regionId: string) => void;
}) {
  const known = Boolean(regionData[id]);
  const name = regionName(regionData, id);
  if (!known) return <span>{name}</span>;
  return (
    <button
      type="button"
      onClick={() => onSelectRegion(id)}
      className="map-link text-left"
    >
      {name}
    </button>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-[var(--tfmc-mist)]">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm text-[var(--tfmc-cream)]">{children}</dd>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="map-rule mb-2.5">{title}</h3>
      {children}
    </section>
  );
}

function RelationRow({
  relation,
  regionData,
  onSelectRegion,
}: {
  relation: RealmRelation;
  regionData: RegionRecord;
  onSelectRegion: (regionId: string) => void;
}) {
  const kind = relationKindLabel(relation.kind);
  const attitude = relation.attitude ?? "neutral";
  const swatch = regionData[relation.id]?.rgb;
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 rounded-sm ring-1 ring-black/60"
        style={{ backgroundColor: swatch ? `rgb(${swatch})` : "#555" }}
      />
      <span className="min-w-0 flex-1 truncate text-sm">
        <RegionLink id={relation.id} regionData={regionData} onSelectRegion={onSelectRegion} />
        {kind ? <span className="ml-1.5 text-xs text-[var(--tfmc-stone)]">{kind}</span> : null}
      </span>
      <span
        className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.7rem] capitalize ${
          ATTITUDE_STYLES[attitude] ?? ATTITUDE_STYLES.neutral
        }`}
      >
        {attitude}
        {relation.score !== null ? (
          <span className="ml-1 tabular-nums opacity-80">
            {relation.score > 0 ? `+${relation.score}` : relation.score}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function PanelActions({
  onFocusRegion,
  onShowSubjects,
}: Pick<RealmPanelProps, "onFocusRegion" | "onShowSubjects">) {
  if (!onFocusRegion && !onShowSubjects) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {onFocusRegion ? (
        <button type="button" onClick={onFocusRegion} className="map-control h-9 px-3 text-sm">
          <FocusIcon size={16} />
          Zoom to
        </button>
      ) : null}
      {onShowSubjects ? (
        <button type="button" onClick={onShowSubjects} className="map-control h-9 px-3 text-sm">
          <SubjectsIcon size={16} />
          Show subjects
        </button>
      ) : null}
    </div>
  );
}

function RealmBody({
  profile,
  props,
}: {
  profile: RealmProfile;
  props: RealmPanelProps;
}) {
  const {
    mapId,
    mapType,
    regionData,
    sessionToken,
    settlements,
    onSelectRegion,
    onFocusPoint,
    onSelectPlace,
  } = props;
  const capital = realmCapitalSettlement(profile, settlements);
  const relations = sortRealmRelations(profile.relations);
  const guilds = realmGuilds(profile.id, regionData[profile.id]);
  const subjectSize = profile.realmSize - profile.provinces;

  return (
    <>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Fact label="Government">{profile.government ?? "—"}</Fact>
        <Fact label="Culture">{profile.culture ?? "—"}</Fact>
        <Fact label="Faith">{profile.religion ?? "—"}</Fact>
        <Fact label="Capital">
          {capital ? (
            typeof capital.map_x === "number" &&
            typeof capital.map_y === "number" &&
            onFocusPoint ? (
              <button
                type="button"
                onClick={() => {
                  onSelectPlace?.(capital.id);
                  onFocusPoint(capital.map_x!, capital.map_y!);
                }}
                className="map-link text-left"
              >
                {cleanRegionName(capital.name)}
              </button>
            ) : (
              cleanRegionName(capital.name)
            )
          ) : profile.capitalProvince !== null ? (
            "Unnamed"
          ) : (
            "None"
          )}
        </Fact>
        <Fact label="Realm size">
          {profile.realmSize} {profile.realmSize === 1 ? "province" : "provinces"}
          {subjectSize > 0 ? (
            <span className="block text-xs text-[var(--tfmc-stone)]">
              {subjectSize} held by subjects
            </span>
          ) : null}
        </Fact>
        <Fact label="Founded">
          {profile.foundedAt !== null ? formatFoundedDate(profile.foundedAt) : "—"}
        </Fact>
      </dl>

      <PanelActions onFocusRegion={props.onFocusRegion} onShowSubjects={props.onShowSubjects} />

      {profile.subjects.length > 0 ? (
        <Section title={`Subjects · ${profile.subjects.length}`}>
          <ul className="space-y-1.5">
            {profile.subjects.map((subjectId) => (
              <li key={subjectId}>
                <button
                  type="button"
                  onClick={() => onSelectRegion(subjectId)}
                  className="flex w-full items-center gap-2.5 rounded px-1.5 py-1 text-left hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]"
                >
                  <Banner
                    mapId={mapId}
                    mapType={mapType}
                    banner={regionData[subjectId]?.banner}
                    name={regionName(regionData, subjectId)}
                    sessionToken={sessionToken}
                    className="h-8 w-6 shrink-0 border"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--tfmc-cream)]">
                    {regionName(regionData, subjectId)}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--tfmc-stone)]">
                    {regionData[subjectId]?.size ?? 0}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {props.onSelectGuild && guilds.length > 0 ? (
        <Section title={`Guilds · ${guilds.length}`}>
          <GuildList guilds={guilds} onSelectGuild={props.onSelectGuild} />
        </Section>
      ) : null}

      {relations.length > 0 ? (
        <Section title="Relations">
          <ul className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]">
            {relations.map((relation) => (
              <RelationRow
                key={relation.id}
                relation={relation}
                regionData={regionData}
                onSelectRegion={onSelectRegion}
              />
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/**
 * The detail view for whatever is selected on the map: banner, the ruler,
 * then the realm's facts, subjects and relations. Every name in it is a link to that realm.
 *
 * On the nation map it reads the allowlisted `RealmProfile`. Title and trade
 * modes carry less, so they get the same frame with the fields they have.
 */
export function RealmPanelContent(props: RealmPanelProps) {
  const { mapId, mapType, regionId, regionData, mapDisplayName, sessionToken, onSelectRegion } =
    props;
  const raw = regionData[regionId];

  const profile = useMemo(
    () =>
      mapType === "nation" && raw
        ? buildRealmProfile(regionId, raw as Record<string, unknown>)
        : null,
    [mapType, raw, regionId]
  );
  const info = useMemo(
    () => (raw ? buildRegionInfo(regionId, raw, mapType, mapDisplayName, regionData) : null),
    [raw, regionId, mapType, mapDisplayName, regionData]
  );
  if (!raw || !info) return null;

  const name = profile?.name ?? (cleanRegionName(info.title) || regionId);
  const overlordId = raw.overlord ?? null;

  return (
    <article aria-label={name}>
      <PanelCloseButton onClick={props.onClose} />
      <header className="map-frame-header -mx-4 -mt-4 mb-4 flex gap-4 rounded-t-[9px] px-4 pb-4 pt-4">
        <Banner
          mapId={mapId}
          mapType={mapType}
          banner={profile?.banner ?? info.banner}
          name={name}
          sessionToken={sessionToken}
          className="h-[5.5rem] w-16 shrink-0"
        />
        <div className="min-w-0 flex-1 pr-9">
          <p className="text-xs text-[var(--tfmc-mist)]">
            {profile?.rank ? `${profile.rank} realm` : mapType === "trade" ? "Trade area" : info.tier}
          </p>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl leading-tight text-[var(--tfmc-cream)]">
            {name}
          </h2>
          <p className="mt-1 text-sm text-[var(--tfmc-stone)]">
            {overlordId ? (
              <>
                {mapType === "nation" ? "Subject of " : "Part of "}
                <RegionLink id={overlordId} regionData={regionData} onSelectRegion={onSelectRegion} />
              </>
            ) : mapType === "nation" ? (
              "Independent realm"
            ) : (
              info.description
            )}
          </p>
        </div>
      </header>

      {profile ? (
        <>
          {/* Always there, so the ruler never seems to have gone missing. A
              realm whose leader SimpleFactions has not yet seen online under
              a character says so, rather than naming their account. */}
          <div className="mb-4 flex items-baseline gap-2 rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] bg-black/20 px-3 py-2">
            <span className="shrink-0 text-xs text-[var(--tfmc-mist)]">
              {profile.rulerTitle ?? "Ruler"}
            </span>
            {profile.leader ? (
              <span className="truncate font-[family-name:var(--font-fraunces)] text-base text-[var(--tfmc-cream)]">
                {profile.leader}
              </span>
            ) : (
              <span className="truncate text-sm italic text-[var(--tfmc-stone)]">
                Character not yet known
              </span>
            )}
          </div>
          <RealmBody profile={profile} props={props} />
        </>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Fact label={mapType === "trade" ? "Type" : "Tier"}>{info.tier}</Fact>
            {info.size > 0 ? <Fact label="Provinces">{info.size}</Fact> : null}
          </dl>
          <PanelActions onFocusRegion={props.onFocusRegion} onShowSubjects={props.onShowSubjects} />
          {info.subjects.length > 0 ? (
            <Section title={`Contains · ${info.subjects.length}`}>
              <ul className="flex flex-wrap gap-1.5">
                {info.subjects.map((subjectId) => (
                  <li key={subjectId}>
                    <button
                      type="button"
                      onClick={() => onSelectRegion(subjectId)}
                      className="map-control h-8 px-2.5 text-xs"
                    >
                      {regionName(regionData, subjectId)}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </>
      )}
    </article>
  );
}

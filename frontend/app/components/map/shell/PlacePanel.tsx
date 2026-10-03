"use client";

import { useEffect, useState } from "react";

import { fetchMapJson } from "@/lib/map/api";
import type { PlaceProfile } from "@/app/lib/map/placeProfile";
import {
  buildProvinceCountyNames,
  type CountyNameEntry,
} from "@/app/lib/map/provinceCounty";
import { cleanRegionName } from "@/app/lib/mapLabels";
import { resolveMarkerImageSrc, type MapMarker } from "@/app/lib/mapMarkers";

import type { MapId, RegionRecord } from "../types";
import { Fact, RegionLink } from "./RealmPanel";
import { CloseIcon, FocusIcon, RealmIcon } from "./MapIcons";

/** Province id -> county name per map, shared by every place panel. */
const countyNamesByMap = new Map<string, Promise<Map<number, string>>>();

function countyNames(mapId: MapId, sessionToken?: string | null) {
  let names = countyNamesByMap.get(mapId);
  if (!names) {
    names = fetchMapJson<Record<string, CountyNameEntry>>(`/${mapId}/data/county`, {
      sessionToken,
    })
      .then(buildProvinceCountyNames)
      .catch(() => new Map<number, string>());
    countyNamesByMap.set(mapId, names);
  }
  return names;
}

function useCountyName(
  mapId: MapId,
  provinces: number[],
  sessionToken?: string | null
): string | null {
  const [name, setName] = useState<string | null>(null);
  const first = provinces[0];
  useEffect(() => {
    setName(null);
    if (first === undefined) return;
    let cancelled = false;
    void countyNames(mapId, sessionToken).then((names) => {
      if (!cancelled) setName(names.get(first) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [mapId, first, sessionToken]);
  return name;
}

type PlacePanelProps = {
  mapId: MapId;
  place: PlaceProfile;
  marker: MapMarker;
  regionData: RegionRecord | null;
  sessionToken?: string | null;
  onSelectRegion: (regionId: string) => void;
  onFocusPoint: (mapX: number, mapY: number) => void;
  onClose: () => void;
};

/**
 * Details for a settlement, installation or battle marker: the place-card a
 * map site opens when you click a pin. Names the owning realm with a link to
 * its own panel.
 */
export function PlacePanelContent({
  mapId,
  place,
  marker,
  regionData,
  sessionToken,
  onSelectRegion,
  onFocusPoint,
  onClose,
}: PlacePanelProps) {
  const county = useCountyName(mapId, place.provinces, sessionToken);
  const owner = place.ownerId ? regionData?.[place.ownerId] : undefined;
  const ownerName = place.ownerId
    ? cleanRegionName(owner?.name ?? place.ownerId) || place.ownerId
    : null;
  const eyebrow =
    place.kindLabel === "Capital" && ownerName ? `Capital of ${ownerName}` : place.kindLabel;

  return (
    <article aria-label={place.name}>
      <header className="map-frame-header -mx-4 -mt-4 mb-4 flex items-center gap-4 rounded-t-[9px] px-4 pb-4 pt-4">
        <div className="map-banner-frame flex h-16 w-16 shrink-0 items-center justify-center bg-black/30">
          <img
            src={resolveMarkerImageSrc(marker.kind, marker.markerSize)}
            alt=""
            className="h-12 w-12 object-contain [image-rendering:pixelated]"
          />
        </div>
        <div className="min-w-0 flex-1 pr-7">
          <p className="text-xs text-[var(--tfmc-mist)]">{eyebrow}</p>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl leading-tight text-[var(--tfmc-cream)]">
            {place.name}
          </h2>
          {place.ownerId ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-[var(--tfmc-stone)]">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-black/60"
                style={{ backgroundColor: owner?.rgb ? `rgb(${owner.rgb})` : "#555" }}
              />
              <RegionLink id={place.ownerId} regionData={regionData ?? {}} onSelectRegion={onSelectRegion} />
            </p>
          ) : place.kindLabel !== "Battle" ? (
            <p className="mt-1 text-sm text-[var(--tfmc-stone)]">No realm</p>
          ) : null}
        </div>
      </header>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close details"
        className="map-control absolute right-3 top-3 h-8 w-8"
      >
        <CloseIcon size={16} />
      </button>

      {place.note ? (
        <p className="mb-4 whitespace-pre-line text-sm text-[var(--tfmc-stone)]">{place.note}</p>
      ) : null}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        {place.population !== null ? <Fact label="Population">{place.population}</Fact> : null}
        {place.hubSlots !== null ? (
          <Fact label="Supply hubs">
            {place.hubs ?? 0} of {place.hubSlots}
          </Fact>
        ) : null}
        {county ? <Fact label="County">{county}</Fact> : null}
        {place.provinces.length > 1 ? (
          <Fact label="Provinces">{place.provinces.length}</Fact>
        ) : null}
        <Fact label="Coordinates">
          <span className="tabular-nums">
            x {Math.round(place.mapX)}, z {Math.round(place.mapY)}
          </span>
        </Fact>
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onFocusPoint(place.mapX, place.mapY)}
          className="map-control h-9 px-3 text-sm"
        >
          <FocusIcon size={16} />
          Zoom to
        </button>
        {place.ownerId ? (
          <button
            type="button"
            onClick={() => onSelectRegion(place.ownerId!)}
            className="map-control h-9 px-3 text-sm"
          >
            <RealmIcon size={16} />
            View realm
          </button>
        ) : null}
      </div>
    </article>
  );
}

// hooks/useMapModeData.ts
import { useEffect, useState } from "react";

import type { MapId, MapMode } from "../components/map/types";
import { MapAccessError, staffMapAccessReason } from "@/lib/map/api";
import {
  MapModeNotCapturedError,
  fetchMapModeRegionData,
  filterMapModeRegions,
} from "@/app/lib/map/dataSource";
import { isChronicleDayFileMissing } from "@/app/lib/map/chronicleData";
import type { MapAccessGateReason } from "../components/map/MapAccessGate";

export function useMapModeData({
  mapId,
  mapType,
  loadData,
  sessionToken,
  day = null,
}: {
  mapId: MapId;
  mapType: string;
  loadData: (data: Record<string, any>) => void;
  sessionToken?: string | null;
  /**
   * A chronicle day, or `null` for the live map. Taken as a parameter rather
   * than read from `ChronicleDayContext` so the data flow is visible at the
   * call site and this hook stays usable without a provider.
   */
  day?: string | null;
}) {
  const [regionData, setRegionData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState<MapAccessGateReason | null>(
    null
  );
  /**
   * True when a historical day simply has no data for this mode — only
   * `nation` and `trade` are captured. Not an error: the caller renders an
   * honest "not recorded for this day" note instead of a failure, and instead
   * of today's map under a past date.
   */
  const [notCapturedForDay, setNotCapturedForDay] = useState(false);
  /**
   * True when the mode *is* captured but this particular day's snapshot is
   * missing that source file. Deliberately **not** merged with
   * `notCapturedForDay`: "we never record this" and "this day's capture lost
   * the file" are different facts and the sentence the user reads differs.
   *
   * `ChronicleDayFileMissingError` extends `MapAccessError` with status 404,
   * so it matches neither the 403 branch nor `MapModeNotCapturedError`;
   * without this it fell through to `console.error` and left `regionData`
   * null, which renders bare terrain under a banner asserting a real date.
   */
  const [dayFileMissing, setDayFileMissing] = useState(false);

  useEffect(() => {
    // Map modes with no region data
    if (
      mapType === "terrain" ||
      mapType === "fertility" ||
      mapType === "prosperity" ||
      mapType === "infestation" ||
      mapType === "province"
    ) {
      setRegionData(null);
      setLoading(false);
      setAccessError(null);
      setNotCapturedForDay(false);
      setDayFileMissing(false);
      loadData({});
      return;
    }

    let cancelled = false;

    // Drop previous mode's regions so title rollups cannot read stale ids.
    setRegionData(null);
    setLoading(true);
    setAccessError(null);
    setNotCapturedForDay(false);
    setDayFileMissing(false);
    loadData({});

    const fetchRegionData = async () => {
      try {
        const rawData = await fetchMapModeRegionData({
          mapId,
          mapType: mapType as MapMode,
          day,
          sessionToken,
        });
        if (cancelled) return;

        // Same filter as before, moved into `filterMapModeRegions` so the day
        // path and the live path cannot drift apart.
        const filteredData = filterMapModeRegions(rawData, mapType);

        setRegionData(filteredData);
        loadData(filteredData);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof MapAccessError && err.status === 403) {
          setAccessError(staffMapAccessReason(err));
        } else if (isChronicleDayFileMissing(err)) {
          // Checked before the generic `MapAccessError` shapes below because
          // it is one (status 404). A hole in one day's capture is a normal
          // stored state, not something to log or retry.
          setDayFileMissing(true);
        } else if (err instanceof MapModeNotCapturedError) {
          // Expected for eight of the ten modes under any day. Nothing to log
          // and nothing to gate on — the caller reads `notCapturedForDay`.
          setNotCapturedForDay(true);
        } else {
          console.error("Error fetching region data:", err);
        }
        setRegionData(null);
        loadData({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchRegionData();

    return () => {
      cancelled = true;
    };
  }, [mapId, mapType, sessionToken, loadData, day]);

  return { regionData, loading, accessError, notCapturedForDay, dayFileMissing };
}

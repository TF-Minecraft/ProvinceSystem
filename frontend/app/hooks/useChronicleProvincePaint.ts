import { useEffect, useState } from "react";

import type { MapId, MapMode } from "../components/map/types";
import { MapAccessError, staffMapAccessReason } from "@/lib/map/api";
import type { MapAccessGateReason } from "../components/map/MapAccessGate";
import { fetchChronicleDayFile, isChronicleDayFileMissing } from "../lib/map/chronicleData";
import { chronicleProvincePaintLut, chronicleProvincePaintSource } from "../lib/map/chronicleDayModes";
import type { NationColorLut } from "../lib/map/chroniclePaint";

/**
 * The colour LUT for a day-varying *raster* mode — `prosperity` and
 * `infestation` — read from that day's capture.
 *
 * On the live map these modes are a server-rendered PNG at
 * `/{mapId}/mapdata/{mode}`, regenerated from today's data with no per-day
 * variant. Under a stored day that image is the second live-leak path, so this
 * hook replaces it: the fetch is day-scoped by construction (there is no live
 * branch in it at all — `chronicleProvincePaintSource` returns `live` for every
 * mode this hook then declines to fetch), and the pixels are painted from the
 * captured file by `ChronicleProvincePaintLayer`.
 *
 * All the colour policy lives in `chronicleProsperity` / `chronicleInfestation`
 * and is dispatched by the pure `chronicleProvincePaintLut`, so this hook only
 * owns fetching and lifecycle.
 */
export function useChronicleProvincePaint({
  mapId,
  mapType,
  day,
  sessionToken,
}: {
  mapId: MapId;
  mapType: MapMode;
  /** A chronicle day, or `null` for the live map (which uses none of this). */
  day: string | null;
  sessionToken?: string | null;
}): {
  lut: NationColorLut | null;
  loading: boolean;
  /**
   * The mode is captured in principle but this day's snapshot has no such
   * file. `main` has no `infestation_data.json` at all, so this is the normal
   * state for infestation there — the caller renders the same honest
   * missing-file panel `useMapModeData` drives, not an error.
   */
  dayFileMissing: boolean;
  accessError: MapAccessGateReason | null;
} {
  const [lut, setLut] = useState<NationColorLut | null>(null);
  const [loading, setLoading] = useState(false);
  const [dayFileMissing, setDayFileMissing] = useState(false);
  const [accessError, setAccessError] = useState<MapAccessGateReason | null>(null);

  useEffect(() => {
    const source = chronicleProvincePaintSource(mapType, day);

    // Every other mode — region modes, and the static rasters that correctly
    // keep their live PNG — resolves to nothing here and pays no request.
    if (source?.kind !== "day") {
      setLut(null);
      setLoading(false);
      setDayFileMissing(false);
      setAccessError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    // Drop the previous mode's LUT first: painting last mode's colours while
    // this one loads is exactly the kind of quiet wrongness this page exists
    // to avoid.
    setLut(null);
    setLoading(true);
    setDayFileMissing(false);
    setAccessError(null);

    void fetchChronicleDayFile<unknown>(mapId, source.day, source.file, sessionToken, controller.signal)
      .then((file) => {
        if (cancelled) return;
        setLut(chronicleProvincePaintLut(source.mapType, file.value));
      })
      .catch((err) => {
        if (cancelled || controller.signal.aborted) return;
        if (isChronicleDayFileMissing(err)) {
          // Checked before the generic `MapAccessError` shapes: it is one
          // (status 404), and a source a map never had is a normal state.
          setDayFileMissing(true);
        } else if (err instanceof MapAccessError && err.status === 403) {
          setAccessError(staffMapAccessReason(err));
        } else {
          console.error("Error fetching chronicle province paint:", err);
        }
        setLut(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mapId, mapType, day, sessionToken]);

  return { lut, loading, dayFileMissing, accessError };
}
